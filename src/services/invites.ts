import 'server-only'

import { desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import { characters, guildInvites, guildSettings, guilds, users } from '@/db/schema'
import { recordAudit } from '@/lib/audit'
import { generateInviteToken, hashInviteToken, inviteTokenLookup, verifyInviteToken } from '@/lib/crypto'
import { AppError, unwrap } from '@/lib/errors'
import {
  authorizeInviteIssue,
  describeInviteStatus,
  evaluateInviteRedemption,
  resolveInviteExpiry,
  type Actor,
  type InviteStatus,
} from '@/lib/rules'
import { registerSchema } from '@/lib/account-schemas'
import { adminCreateUser } from '@/lib/supabase-auth'

/**
 * Guild invites: the only door through which a guild comes into existence.
 *
 * There is deliberately no other function in this codebase that inserts a row
 * into `guilds`. Anything that creates a guild has to spend an invite, and the
 * invite row keeps the receipt - who issued it, who spent it, and what it
 * produced.
 */

export const redeemInviteSchema = registerSchema.omit({ guildSlug: true }).extend({
  token: z.string().trim().min(16).max(128),
  guildName: z.string().trim().min(3).max(80),
  guildTag: z.string().trim().min(1).max(8).optional(),
})

export type RedeemInviteInput = z.infer<typeof redeemInviteSchema>

/** URL-safe, lowercase, collapsed. The public identifier of a guild. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

async function insertInvite(params: {
  createdByUserId: string | null
  note: string | null
  now: Date
}): Promise<{ id: string; token: string; expiresAt: Date }> {
  const token = generateInviteToken()
  const expiresAt = resolveInviteExpiry(params.now)

  const [invite] = await db
    .insert(guildInvites)
    .values({
      tokenHash: await hashInviteToken(token),
      tokenLookup: inviteTokenLookup(token),
      tokenHint: token.slice(-6),
      note: params.note,
      createdByUserId: params.createdByUserId,
      expiresAt,
    })
    .returning({ id: guildInvites.id })

  if (!invite) throw new AppError('INTERNAL_ERROR', 'Failed to create the invite', 500)

  await recordAudit({
    guildId: null,
    actorUserId: params.createdByUserId,
    action: 'invite.issue',
    entityType: 'guild_invite',
    entityId: invite.id,
    // The token is never written anywhere, including here.
    after: { hint: token.slice(-6), expiresAt, note: params.note },
  })

  return { id: invite.id, token, expiresAt }
}

/**
 * Issues an invite from inside the app. Returns the token ONCE - only its
 * digest is stored, so a super admin who loses the link issues a new one.
 */
export async function issueInvite(params: {
  actor: Actor
  note?: string
  now: Date
}): Promise<{ id: string; token: string; expiresAt: Date }> {
  unwrap(authorizeInviteIssue(params.actor))

  const note = params.note?.trim()
  if (note && note.length > 200) {
    throw new AppError('INVALID_NOTE', 'The note must be at most 200 characters')
  }

  return insertInvite({ createdByUserId: params.actor.id, note: note || null, now: params.now })
}

/**
 * Issues an invite with no actor at all, for the operator CLI.
 *
 * This is the bootstrap: a fresh database has no users, so there is nobody who
 * could authorize the first invite from inside the app. It requires database
 * credentials, which is a stronger check than any web session.
 */
export async function issueInviteFromOperator(params: {
  note?: string
  now: Date
}): Promise<{ id: string; token: string; expiresAt: Date }> {
  return insertInvite({
    createdByUserId: null,
    note: params.note?.trim() || null,
    now: params.now,
  })
}

export async function revokeInvite(params: {
  actor: Actor
  inviteId: string
  now: Date
}): Promise<void> {
  const { actor, inviteId, now } = params
  unwrap(authorizeInviteIssue(actor))

  await db.transaction(async (tx) => {
    const [invite] = await tx
      .select()
      .from(guildInvites)
      .where(eq(guildInvites.id, inviteId))
      .limit(1)
      .for('update')
    if (!invite) throw new AppError('NOT_FOUND', 'Invite not found', 404)

    const status = describeInviteStatus(invite, now)
    if (status !== 'LIVE') {
      throw new AppError('INVITE_NOT_LIVE', `This invite is already ${status.toLowerCase()}`)
    }

    await tx
      .update(guildInvites)
      .set({ revokedAt: now, revokedByUserId: actor.id })
      .where(eq(guildInvites.id, inviteId))

    await recordAudit(
      {
        guildId: null,
        actorUserId: actor.id,
        action: 'invite.revoke',
        entityType: 'guild_invite',
        entityId: inviteId,
        after: { hint: invite.tokenHint },
      },
      tx,
    )
  })
}

export async function listInvites(actor: Actor, limit = 100) {
  unwrap(authorizeInviteIssue(actor))

  return db
    .select({
      id: guildInvites.id,
      hint: guildInvites.tokenHint,
      note: guildInvites.note,
      expiresAt: guildInvites.expiresAt,
      redeemedAt: guildInvites.redeemedAt,
      revokedAt: guildInvites.revokedAt,
      createdAt: guildInvites.createdAt,
      guildName: guilds.name,
      redeemedByEmail: users.email,
    })
    .from(guildInvites)
    .leftJoin(guilds, eq(guilds.id, guildInvites.guildId))
    .leftJoin(users, eq(users.id, guildInvites.redeemedByUserId))
    .orderBy(desc(guildInvites.createdAt))
    .limit(limit)
}

/**
 * Finds an invite by its token. Returns null for anything that does not match,
 * so a wrong token and a token for another server are indistinguishable.
 */
async function findByToken(token: string) {
  const [invite] = await db
    .select()
    .from(guildInvites)
    .where(eq(guildInvites.tokenLookup, inviteTokenLookup(token)))
    .limit(1)

  if (!invite) return null
  // The blind index narrows it to one row; the digest is what proves the token.
  if (!(await verifyInviteToken(token, invite.tokenHash))) return null
  return invite
}

/** What the invite screen may say before anyone fills the form in. */
export async function peekInvite(token: string, now: Date): Promise<InviteStatus | 'UNKNOWN'> {
  const invite = await findByToken(token)
  if (!invite) return 'UNKNOWN'
  return describeInviteStatus(invite, now)
}

/**
 * Spends an invite and creates the guild together with its leader account.
 *
 * Ordering matters. The invite is checked first, so a dead link never leaves a
 * Supabase credential behind; the Supabase user is created next, because an
 * external call cannot be rolled back; and the invite is marked spent inside
 * the same transaction as the guild, with the row locked, so two people
 * clicking the same link at the same time cannot produce two guilds.
 */
export async function redeemInviteAndCreateGuild(params: {
  input: RedeemInviteInput
  /** The signed-in caller, if any. Having one is a denial, not a shortcut. */
  actor: Actor | null
  now: Date
}): Promise<{ guildId: string; userId: string; slug: string }> {
  const { actor, now } = params
  const parsed = redeemInviteSchema.parse(params.input)
  const email = parsed.email.toLowerCase()

  const invite = await findByToken(parsed.token)
  if (!invite) throw new AppError('INVITE_INVALID', 'This invite link is not valid')
  unwrap(evaluateInviteRedemption({ invite, actor, now }))

  const slug = slugify(parsed.guildName)
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
    // Re-read under a lock: between the check above and here, somebody else
    // may have spent this very link.
    const [locked] = await tx
      .select()
      .from(guildInvites)
      .where(eq(guildInvites.id, invite.id))
      .limit(1)
      .for('update')
    if (!locked) throw new AppError('INVITE_INVALID', 'This invite link is not valid')
    unwrap(evaluateInviteRedemption({ invite: locked, actor, now }))

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

    await tx
      .update(guildInvites)
      .set({ redeemedAt: now, redeemedByUserId: user.id, guildId: guild.id })
      .where(eq(guildInvites.id, invite.id))

    await recordAudit(
      {
        guildId: guild.id,
        actorUserId: user.id,
        action: 'guild.create',
        entityType: 'guild',
        entityId: guild.id,
        after: { name: guild.name, slug, leaderEmail: email, inviteId: invite.id },
      },
      tx,
    )

    return { guildId: guild.id, userId: user.id, slug }
  })
}
