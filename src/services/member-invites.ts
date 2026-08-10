import 'server-only'

import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, type Executor } from '@/db'
import { guildSettings, guilds, memberInvites, users, type JoinPolicy } from '@/db/schema'
import { recordAudit } from '@/lib/audit'
import { generateInviteToken, hashInviteToken, inviteTokenLookup, verifyInviteToken } from '@/lib/crypto'
import { AppError, unwrap } from '@/lib/errors'
import {
  authorizeAdminAction,
  describeMemberInviteStatus,
  evaluateMemberInviteIssue,
  MEMBER_INVITE_MAX_TTL_HOURS,
  MEMBER_INVITE_MAX_USES,
  type Actor,
  type MemberInviteStatus,
} from '@/lib/rules'

/**
 * Recruitment links: how somebody joins a guild that already exists.
 *
 * Not to be confused with `invites.ts`, which mints guilds and is a super-admin
 * power. This one belongs to the guild's own admins and can only ever add a
 * member to *their* guild - the guild id comes from the actor, never from the
 * request.
 */

export const issueMemberInviteSchema = z.object({
  note: z.string().trim().max(200).optional(),
  maxUses: z.number(),
  ttlHours: z.number(),
})

export type IssueMemberInviteInput = z.infer<typeof issueMemberInviteSchema>

export async function issueMemberInvite(params: {
  actor: Actor
  input: IssueMemberInviteInput
  now: Date
}): Promise<{ id: string; token: string; expiresAt: Date; maxUses: number }> {
  const { actor, now } = params
  const input = issueMemberInviteSchema.parse(params.input)

  const plan = unwrap(
    evaluateMemberInviteIssue({
      actor,
      guildId: actor.guildId,
      maxUses: input.maxUses,
      ttlHours: input.ttlHours,
      now,
    }),
  )

  const token = generateInviteToken()

  const [invite] = await db
    .insert(memberInvites)
    .values({
      guildId: actor.guildId,
      tokenHash: await hashInviteToken(token),
      tokenLookup: inviteTokenLookup(token),
      tokenHint: token.slice(-6),
      note: input.note || null,
      createdByUserId: actor.id,
      expiresAt: plan.expiresAt,
      maxUses: plan.maxUses,
    })
    .returning({ id: memberInvites.id })

  if (!invite) throw new AppError('INTERNAL_ERROR', 'Failed to create the invite', 500)

  await recordAudit({
    guildId: actor.guildId,
    actorUserId: actor.id,
    action: 'member_invite.issue',
    entityType: 'member_invite',
    entityId: invite.id,
    // The token is never written anywhere, including here.
    after: { hint: token.slice(-6), maxUses: plan.maxUses, expiresAt: plan.expiresAt },
  })

  return { id: invite.id, token, expiresAt: plan.expiresAt, maxUses: plan.maxUses }
}

export async function revokeMemberInvite(params: {
  actor: Actor
  inviteId: string
  now: Date
}): Promise<void> {
  const { actor, inviteId, now } = params

  await db.transaction(async (tx) => {
    const [invite] = await tx
      .select()
      .from(memberInvites)
      .where(eq(memberInvites.id, inviteId))
      .limit(1)
      .for('update')
    // Same denial for "not yours" and "does not exist".
    if (!invite || invite.guildId !== actor.guildId) {
      throw new AppError('FORBIDDEN', 'You are not allowed to access this resource', 403)
    }
    unwrap(authorizeAdminAction(actor, invite.guildId))

    if (describeMemberInviteStatus(invite, now) !== 'LIVE') {
      throw new AppError('INVITE_NOT_LIVE', 'This invite is no longer live')
    }

    await tx
      .update(memberInvites)
      .set({ revokedAt: now, revokedByUserId: actor.id })
      .where(eq(memberInvites.id, inviteId))

    await recordAudit(
      {
        guildId: invite.guildId,
        actorUserId: actor.id,
        action: 'member_invite.revoke',
        entityType: 'member_invite',
        entityId: inviteId,
        after: { hint: invite.tokenHint },
      },
      tx,
    )
  })
}

export async function listMemberInvites(actor: Actor, limit = 100) {
  unwrap(authorizeAdminAction(actor, actor.guildId))

  return db
    .select({
      id: memberInvites.id,
      guildId: memberInvites.guildId,
      hint: memberInvites.tokenHint,
      note: memberInvites.note,
      expiresAt: memberInvites.expiresAt,
      maxUses: memberInvites.maxUses,
      usedCount: memberInvites.usedCount,
      revokedAt: memberInvites.revokedAt,
      createdAt: memberInvites.createdAt,
      issuedByEmail: users.email,
    })
    .from(memberInvites)
    .leftJoin(users, eq(users.id, memberInvites.createdByUserId))
    .where(eq(memberInvites.guildId, actor.guildId))
    .orderBy(desc(memberInvites.createdAt))
    .limit(limit)
}

/**
 * Resolves a recruitment token. Returns null for anything that does not match,
 * so a wrong token and a token for another server look identical.
 */
export async function findMemberInviteByToken(token: string, executor: Executor = db) {
  if (!token) return null

  const [invite] = await executor
    .select()
    .from(memberInvites)
    .where(eq(memberInvites.tokenLookup, inviteTokenLookup(token)))
    .limit(1)

  if (!invite) return null
  if (!(await verifyInviteToken(token, invite.tokenHash))) return null
  return invite
}

/** What the sign-up screen may say before anyone fills the form in. */
export async function peekMemberInvite(
  token: string,
  now: Date,
): Promise<{ status: MemberInviteStatus | 'UNKNOWN'; guildName: string | null; seatsLeft: number }> {
  const invite = await findMemberInviteByToken(token)
  if (!invite) return { status: 'UNKNOWN', guildName: null, seatsLeft: 0 }

  const [guild] = await db
    .select({ name: guilds.name })
    .from(guilds)
    .where(eq(guilds.id, invite.guildId))
    .limit(1)

  return {
    status: describeMemberInviteStatus(invite, now),
    guildName: guild?.name ?? null,
    seatsLeft: Math.max(0, invite.maxUses - invite.usedCount),
  }
}

export const MEMBER_INVITE_LIMITS = {
  maxUses: MEMBER_INVITE_MAX_USES,
  maxTtlHours: MEMBER_INVITE_MAX_TTL_HOURS,
}

/**
 * Opens or closes the guild to public sign-ups.
 *
 * The only guild setting editable from the interface so far. It lives here
 * rather than in a general settings screen because it is the other half of the
 * recruitment story: a link is pointless while anyone can walk in, and closing
 * the door is pointless without a link to hand out.
 */
export async function setJoinPolicy(params: {
  actor: Actor
  policy: JoinPolicy
  now: Date
}): Promise<void> {
  const { actor, policy, now } = params
  unwrap(authorizeAdminAction(actor, actor.guildId))

  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ joinPolicy: guildSettings.joinPolicy })
      .from(guildSettings)
      .where(eq(guildSettings.guildId, actor.guildId))
      .limit(1)
    if (!current) throw new AppError('NOT_FOUND', 'Guild settings not found', 404)
    if (current.joinPolicy === policy) return

    await tx
      .update(guildSettings)
      .set({ joinPolicy: policy, updatedAt: now })
      .where(eq(guildSettings.guildId, actor.guildId))

    await recordAudit(
      {
        guildId: actor.guildId,
        actorUserId: actor.id,
        action: 'guild.join_policy',
        entityType: 'guild',
        entityId: actor.guildId,
        before: { joinPolicy: current.joinPolicy },
        after: { joinPolicy: policy },
      },
      tx,
    )
  })
}

export async function getJoinPolicy(guildId: string): Promise<JoinPolicy> {
  const [row] = await db
    .select({ joinPolicy: guildSettings.joinPolicy })
    .from(guildSettings)
    .where(eq(guildSettings.guildId, guildId))
    .limit(1)
  return row?.joinPolicy ?? 'OPEN'
}
