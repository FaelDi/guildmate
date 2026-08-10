import 'server-only'

import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import { characters, guildSettings, guilds, users } from '@/db/schema'
import { recordAudit } from '@/lib/audit'
import { AppError } from '@/lib/errors'
import { rateLimit } from '@/lib/rate-limit'
import { loadRestrictions } from '@/lib/restrictions'
import { evaluateAccountAccess } from '@/lib/rules'
import { clearSessionCookies, readAccessToken, readRefreshToken, setSessionCookies } from '@/lib/session-cookies'
import { adminCreateUser, signInWithPassword, signOut } from '@/lib/supabase-auth'

const LOCKOUT_THRESHOLD = 8
const LOCKOUT_MINUTES = 15

/** Deliberately identical for every failure mode: no user enumeration. */
const GENERIC_SIGN_IN_ERROR = 'Invalid email or password'

export const passwordSchema = z
  .string()
  .min(10, 'The password must have at least 10 characters')
  .max(200)

export const registerSchema = z.object({
  email: z.string().trim().email().max(254),
  password: passwordSchema,
  guildSlug: z.string().trim().min(2).max(60),
  characterName: z.string().trim().min(2).max(40),
  race: z.enum(['BELLATO', 'CORA', 'ACCRETIA']),
  biosuit: z.string().trim().min(1).max(60),
  level: z.number().int().min(1).max(999),
  kind: z.enum(['MAIN', 'ALT']),
})

export type RegisterInput = z.infer<typeof registerSchema>

/**
 * Creates the credential in Supabase Auth and the domain row in our database.
 *
 * Ordering matters: the Supabase user is created first, because our
 * transaction can be rolled back while an external API call cannot. If the
 * local insert fails we are left with an orphan credential that owns nothing -
 * harmless, and reclaimable on retry with the same email.
 */
export async function registerAccount(input: RegisterInput): Promise<{ userId: string }> {
  const parsed = registerSchema.parse(input)
  const email = parsed.email.toLowerCase()

  const [guild] = await db.select().from(guilds).where(eq(guilds.slug, parsed.guildSlug)).limit(1)
  if (!guild || !guild.isActive) {
    throw new AppError('GUILD_NOT_FOUND', 'That guild does not exist or is not accepting members')
  }

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email))
    .limit(1)
  if (existing) {
    // Same message the caller would get for a taken address in Supabase, so
    // the endpoint cannot be used to test which emails are registered.
    throw new AppError('REGISTRATION_FAILED', 'This account could not be created')
  }

  const created = await adminCreateUser({ email, password: parsed.password })
  if (!created) throw new AppError('REGISTRATION_FAILED', 'This account could not be created')

  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        guildId: guild.id,
        email,
        supabaseUserId: created.supabaseUserId,
        role: 'MEMBER',
        status: 'ACTIVE',
        isActive: true,
      })
      .returning({ id: users.id })

    if (!user) throw new AppError('REGISTRATION_FAILED', 'This account could not be created')

    await tx.insert(characters).values({
      userId: user.id,
      guildId: guild.id,
      name: parsed.characterName,
      nameNormalized: parsed.characterName.toLowerCase(),
      race: parsed.race,
      biosuit: parsed.biosuit,
      level: parsed.level,
      // A first character declared as an ALT has no main to roll up to yet;
      // the member links it from their profile once the main exists.
      kind: parsed.kind,
      mainCharacterId: null,
    })

    await recordAudit(
      {
        guildId: guild.id,
        actorUserId: user.id,
        action: 'account.register',
        entityType: 'user',
        entityId: user.id,
        after: { email, guildId: guild.id, characterName: parsed.characterName },
      },
      tx,
    )

    return { userId: user.id }
  })
}

export const signInSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200),
})

/**
 * Signs in through our own server, then stores the Supabase tokens in httpOnly
 * cookies. The browser never sees a Supabase endpoint or key.
 *
 * Because every attempt passes through here, the per-account lockout below is
 * genuinely enforced, layered on top of GoTrue's own rate limiting.
 */
export async function signIn(input: z.infer<typeof signInSchema>): Promise<void> {
  const parsed = signInSchema.parse(input)
  const email = parsed.email.toLowerCase()
  const now = new Date()

  const burst = rateLimit({ key: `signin:${email}`, limit: 10, windowMs: 60_000 })
  if (!burst.allowed) {
    throw new AppError('RATE_LIMITED', 'Too many sign-in attempts. Try again in a minute.', 429)
  }

  const [user] = await db.select().from(users).where(eq(sql`lower(${users.email})`, email)).limit(1)

  if (user) {
    if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
      throw new AppError('ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.', 429)
    }
    const access = evaluateAccountAccess(user, await loadRestrictions(user.id), now)
    if (!access.ok) {
      // Do not reveal that the address exists but is banned.
      throw new AppError('INVALID_CREDENTIALS', GENERIC_SIGN_IN_ERROR, 401)
    }
  }

  const session = await signInWithPassword(email, parsed.password)

  if (!session) {
    if (user) {
      const failed = user.failedLoginCount + 1
      await db
        .update(users)
        .set({
          failedLoginCount: failed,
          lockedUntil:
            failed >= LOCKOUT_THRESHOLD
              ? new Date(now.getTime() + LOCKOUT_MINUTES * 60_000)
              : user.lockedUntil,
          updatedAt: now,
        })
        .where(eq(users.id, user.id))
    }
    throw new AppError('INVALID_CREDENTIALS', GENERIC_SIGN_IN_ERROR, 401)
  }

  // A Supabase credential with no domain row cannot act: refuse rather than
  // creating one implicitly.
  if (!user) {
    throw new AppError('INVALID_CREDENTIALS', GENERIC_SIGN_IN_ERROR, 401)
  }

  await db
    .update(users)
    .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now, updatedAt: now })
    .where(eq(users.id, user.id))

  await setSessionCookies(session)
}

export async function signOutCurrent(): Promise<void> {
  const accessToken = await readAccessToken()
  const refreshToken = await readRefreshToken()
  if (accessToken && refreshToken) await signOut(accessToken)
  await clearSessionCookies()
}

// ---------------------------------------------------------------------------
// Guild bootstrap
// ---------------------------------------------------------------------------

export const createGuildSchema = registerSchema
  .omit({ guildSlug: true })
  .extend({
    guildName: z.string().trim().min(3).max(80),
    guildTag: z.string().trim().min(1).max(8).optional(),
  })

/**
 * Creates a guild together with its first LEADER account. This is the only
 * path that mints a leader: every other member joins as MEMBER and is promoted
 * by an existing admin.
 */
export async function createGuildWithLeader(
  input: z.infer<typeof createGuildSchema>,
): Promise<{ guildId: string; userId: string; slug: string }> {
  const parsed = createGuildSchema.parse(input)
  const email = parsed.email.toLowerCase()
  const slug = parsed.guildName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)

  if (slug.length < 2) throw new AppError('INVALID_NAME', 'That guild name cannot be used')

  const [slugTaken] = await db.select({ id: guilds.id }).from(guilds).where(eq(guilds.slug, slug)).limit(1)
  if (slugTaken) throw new AppError('GUILD_EXISTS', 'A guild with that name already exists')

  const [emailTaken] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email))
    .limit(1)
  if (emailTaken) throw new AppError('REGISTRATION_FAILED', 'This account could not be created')

  const created = await adminCreateUser({ email, password: parsed.password })
  if (!created) throw new AppError('REGISTRATION_FAILED', 'This account could not be created')

  return db.transaction(async (tx) => {
    const [guild] = await tx
      .insert(guilds)
      .values({ name: parsed.guildName, slug, tag: parsed.guildTag ?? null })
      .returning()
    if (!guild) throw new AppError('INTERNAL_ERROR', 'Failed to create the guild', 500)

    await tx.insert(guildSettings).values({ guildId: guild.id })

    const [user] = await tx
      .insert(users)
      .values({
        guildId: guild.id,
        email,
        supabaseUserId: created.supabaseUserId,
        role: 'LEADER',
        status: 'ACTIVE',
        isActive: true,
      })
      .returning({ id: users.id })
    if (!user) throw new AppError('INTERNAL_ERROR', 'Failed to create the account', 500)

    await tx.insert(characters).values({
      userId: user.id,
      guildId: guild.id,
      name: parsed.characterName,
      nameNormalized: parsed.characterName.toLowerCase(),
      race: parsed.race,
      biosuit: parsed.biosuit,
      level: parsed.level,
      kind: 'MAIN',
    })

    await recordAudit(
      {
        guildId: guild.id,
        actorUserId: user.id,
        action: 'guild.create',
        entityType: 'guild',
        entityId: guild.id,
        after: { name: guild.name, slug, leaderEmail: email },
      },
      tx,
    )

    return { guildId: guild.id, userId: user.id, slug }
  })
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

export async function listOwnCharacters(userId: string) {
  return db
    .select()
    .from(characters)
    .where(and(eq(characters.userId, userId), eq(characters.isActive, true)))
    .orderBy(characters.kind, characters.name)
}
