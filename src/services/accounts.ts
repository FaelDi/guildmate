import 'server-only'

import { cache } from 'react'

import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import {
  characters,
  guildSettings,
  guilds,
  memberInviteRedemptions,
  memberInvites,
  users,
} from '@/db/schema'
import { registerSchema, type RegisterInput } from '@/lib/account-schemas'
import { recordAudit } from '@/lib/audit'
import { AppError, unwrap } from '@/lib/errors'
import { rateLimit } from '@/lib/rate-limit'
import { loadRestrictions } from '@/lib/restrictions'
import { evaluateAccountAccess, evaluateJoin } from '@/lib/rules'
import { clearSessionCookies, readAccessToken, readRefreshToken, setSessionCookies } from '@/lib/session-cookies'
import { adminCreateUser, signInWithPassword, signOut } from '@/lib/supabase-auth'
import { findMemberInviteByToken } from './member-invites'

const LOCKOUT_THRESHOLD = 8
const LOCKOUT_MINUTES = 15

/** Deliberately identical for every failure mode: no user enumeration. */
const GENERIC_SIGN_IN_ERROR = 'Invalid email or password'

/**
 * Creates the credential in Supabase Auth and the domain row in our database.
 *
 * Ordering matters: the Supabase user is created first, because our
 * transaction can be rolled back while an external API call cannot. If the
 * local insert fails we are left with an orphan credential that owns nothing -
 * harmless, and reclaimable on retry with the same email.
 */
export async function registerAccount(
  input: RegisterInput,
  options: { token?: string; now?: Date } = {},
): Promise<{ userId: string }> {
  const parsed = registerSchema.parse(input)
  const email = parsed.email.toLowerCase()
  const now = options.now ?? new Date()

  // Quorum is counted per account, so free unlimited account creation is an
  // anti-fraud problem, not just a spam one.
  const burst = rateLimit({ key: `register:${email}`, limit: 3, windowMs: 3_600_000 })
  if (!burst.allowed) {
    throw new AppError('RATE_LIMITED', 'Too many sign-up attempts. Try again later.', 429)
  }
  const token = options.token?.trim() ?? ''

  // A recruitment link names its own guild. Trusting the slug alongside it
  // would let somebody spend a link for guild A to get into guild B.
  const invite = token ? await findMemberInviteByToken(token) : null
  if (token && !invite) throw new AppError('INVITE_INVALID', 'This invite link is not valid')

  if (!invite && !parsed.guildSlug) {
    // The join form always posts a slug; only a hand-built request omits both.
    throw new AppError('GUILD_REQUIRED', 'Choose a guild to join')
  }

  const [guild] = invite
    ? await db.select().from(guilds).where(eq(guilds.id, invite.guildId)).limit(1)
    : await db.select().from(guilds).where(eq(guilds.slug, parsed.guildSlug ?? '')).limit(1)
  if (!guild) {
    throw new AppError('GUILD_NOT_FOUND', 'That guild does not exist or is not accepting members')
  }

  const [settings] = await db
    .select({ joinPolicy: guildSettings.joinPolicy })
    .from(guildSettings)
    .where(eq(guildSettings.guildId, guild.id))
    .limit(1)

  unwrap(
    evaluateJoin({
      guild: { id: guild.id, isActive: guild.isActive, joinPolicy: settings?.joinPolicy ?? 'OPEN' },
      invite,
      now,
    }),
  )

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
    // Re-read the link under a lock: between the check above and here, the
    // last seat may have been taken by somebody else clicking the same URL.
    if (invite) {
      const [locked] = await tx
        .select()
        .from(memberInvites)
        .where(eq(memberInvites.id, invite.id))
        .limit(1)
        .for('update')
      if (!locked) throw new AppError('INVITE_INVALID', 'This invite link is not valid')
      unwrap(
        evaluateJoin({
          guild: { id: guild.id, isActive: guild.isActive, joinPolicy: 'INVITE_ONLY' },
          invite: locked,
          now,
        }),
      )
    }

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

    if (invite) {
      await tx
        .update(memberInvites)
        .set({ usedCount: sql`${memberInvites.usedCount} + 1` })
        .where(eq(memberInvites.id, invite.id))

      await tx
        .insert(memberInviteRedemptions)
        .values({ inviteId: invite.id, userId: user.id, redeemedAt: now })
    }

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
      // Same message as a wrong password: saying "locked" confirms the address
      // is registered, which turns this form into an enumeration oracle.
      throw new AppError('INVALID_CREDENTIALS', GENERIC_SIGN_IN_ERROR, 401)
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
// Characters
// ---------------------------------------------------------------------------

/**
 * The public guild directory shown on the join screen.
 *
 * Counts are aggregated in SQL and no member is ever named: someone who has
 * not joined yet may see how big a guild is, never who is in it. Deleted
 * accounts are excluded entirely - a revoked member is not a member.
 */
export async function listGuildDirectory(limit = 50) {
  return db
    .select({
      id: guilds.id,
      name: guilds.name,
      slug: guilds.slug,
      tag: guilds.tag,
      isActive: guilds.isActive,
      createdAt: guilds.createdAt,
      joinPolicy: guildSettings.joinPolicy,
      members: sql<number>`count(${users.id}) filter (where ${users.deletedAt} is null)`.mapWith(Number),
      active: sql<number>`count(${users.id}) filter (
        where ${users.deletedAt} is null and ${users.isActive} and ${users.status} = 'ACTIVE'
      )`.mapWith(Number),
      suspended: sql<number>`count(${users.id}) filter (
        where ${users.deletedAt} is null and (not ${users.isActive} or ${users.status} <> 'ACTIVE')
      )`.mapWith(Number),
    })
    .from(guilds)
    .leftJoin(users, eq(users.guildId, guilds.id))
    .leftJoin(guildSettings, eq(guildSettings.guildId, guilds.id))
    .groupBy(guilds.id, guildSettings.joinPolicy)
    .orderBy(desc(sql`count(${users.id})`), guilds.name)
    .limit(limit)
}

/**
 * Wrapped in React `cache` because the app shell and the page under it both
 * want the same roster: without it every navigation paid the round trip twice.
 * The cache is per request, so it can never serve one member another one's.
 */
export const listOwnCharacters = cache(async (userId: string) => {
  return db
    .select()
    .from(characters)
    .where(and(eq(characters.userId, userId), eq(characters.isActive, true)))
    .orderBy(characters.kind, characters.name)
})
