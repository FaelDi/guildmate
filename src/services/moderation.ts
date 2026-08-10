import 'server-only'

import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db, type Executor } from '@/db'
import {
  characters,
  eventRegistrations,
  marketListings,
  pointLedger,
  userRestrictions,
  users,
  type RestrictionType,
  type UserRole,
} from '@/db/schema'
import { recordAudit } from '@/lib/audit'
import { AppError, unwrap } from '@/lib/errors'
import { loadRestrictions } from '@/lib/restrictions'
import {
  authorizeAdminAction,
  authorizeModeration,
  authorizeRoleChange,
  deriveUserStatus,
  type Actor,
} from '@/lib/rules'
import { adminSetBan } from '@/lib/supabase-auth'

/** Supabase takes a ban duration, so "permanent" is expressed as 100 years. */
const PERMANENT_BAN_HOURS = 876_000

async function loadTarget(userId: string, executor: Executor = db) {
  const [target] = await executor.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!target) throw new AppError('NOT_FOUND', 'Member not found', 404)
  return target
}

/** Recomputes and persists the status column from the live restrictions. */
async function syncStatus(userId: string, now: Date, tx: Executor): Promise<void> {
  const target = await loadTarget(userId, tx)
  const restrictions = await loadRestrictions(userId, tx)
  const status = deriveUserStatus(target, restrictions, now)
  if (status !== target.status) {
    await tx.update(users).set({ status, updatedAt: now }).where(eq(users.id, userId))
  }
}

// ---------------------------------------------------------------------------
// Logical deactivation
// ---------------------------------------------------------------------------

/**
 * Flips `is_active`. This is the reversible, non-punitive path: the member
 * keeps their history, points and listings, but cannot sign in or act until
 * they are reactivated.
 */
export async function setMemberActive(params: {
  actor: Actor
  userId: string
  isActive: boolean
  reason: string
  now: Date
}): Promise<void> {
  const { actor, userId, isActive, reason, now } = params
  if (reason.trim().length < 3) {
    throw new AppError('REASON_REQUIRED', 'A reason is required')
  }

  await db.transaction(async (tx) => {
    const target = await loadTarget(userId, tx)
    unwrap(authorizeModeration({ actor, target }))

    if (target.deletedAt !== null) {
      throw new AppError('ACCOUNT_DELETED', 'This account has been permanently revoked')
    }

    await tx
      .update(users)
      .set({ isActive, updatedAt: now })
      .where(eq(users.id, userId))

    await syncStatus(userId, now, tx)

    await recordAudit(
      {
        guildId: target.guildId,
        actorUserId: actor.id,
        action: isActive ? 'member.reactivate' : 'member.deactivate',
        entityType: 'user',
        entityId: userId,
        before: { isActive: target.isActive, status: target.status },
        after: { isActive, reason },
      },
      tx,
    )
  })
}

// ---------------------------------------------------------------------------
// Restrictions (ban, suspension, feature blocks)
// ---------------------------------------------------------------------------

export type ApplyRestrictionInput = {
  actor: Actor
  userId: string
  type: RestrictionType
  reason: string
  /** null = permanent. */
  expiresAt: Date | null
  now: Date
}

/**
 * Applies a ban, a timed suspension, or a narrower block (events, auctions,
 * market). Bans and suspensions are mirrored into Supabase Auth so the
 * credential itself stops issuing tokens - defence in depth, in case a bug ever
 * let a request past our own check.
 */
export async function applyRestriction(input: ApplyRestrictionInput): Promise<{ id: string }> {
  const { actor, userId, type, reason, expiresAt, now } = input

  if (reason.trim().length < 3) {
    throw new AppError('REASON_REQUIRED', 'A reason is required for a restriction')
  }
  if (expiresAt !== null && expiresAt.getTime() <= now.getTime()) {
    throw new AppError('INVALID_EXPIRY', 'The expiry must be in the future')
  }

  const { restrictionId, target } = await db.transaction(async (tx) => {
    const target = await loadTarget(userId, tx)
    unwrap(authorizeModeration({ actor, target }))

    const [created] = await tx
      .insert(userRestrictions)
      .values({
        guildId: target.guildId,
        userId,
        type,
        reason: reason.trim(),
        startsAt: now,
        expiresAt,
        createdByUserId: actor.id,
      })
      .returning({ id: userRestrictions.id })

    if (!created) throw new AppError('INTERNAL_ERROR', 'Failed to apply the restriction', 500)

    await syncStatus(userId, now, tx)

    await recordAudit(
      {
        guildId: target.guildId,
        actorUserId: actor.id,
        action: 'member.restrict',
        entityType: 'user_restriction',
        entityId: created.id,
        after: { userId, type, reason, expiresAt },
      },
      tx,
    )

    return { restrictionId: created.id, target }
  })

  if (type === 'BAN' || type === 'SUSPENSION') {
    const hours =
      expiresAt === null
        ? PERMANENT_BAN_HOURS
        : Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 3_600_000))
    // Best effort: our own gate already blocks the member on the next request,
    // so a Supabase hiccup must not roll back the moderation decision.
    try {
      await adminSetBan(target.supabaseUserId, hours)
    } catch (error) {
      console.error('[moderation] failed to mirror ban to Supabase Auth', error)
    }
  }

  return { id: restrictionId }
}

export async function revokeRestriction(params: {
  actor: Actor
  restrictionId: string
  reason: string
  now: Date
}): Promise<void> {
  const { actor, restrictionId, reason, now } = params
  if (reason.trim().length < 3) {
    throw new AppError('REASON_REQUIRED', 'A reason is required')
  }

  const target = await db.transaction(async (tx) => {
    const [restriction] = await tx
      .select()
      .from(userRestrictions)
      .where(eq(userRestrictions.id, restrictionId))
      .limit(1)
    if (!restriction) throw new AppError('NOT_FOUND', 'Restriction not found', 404)

    const target = await loadTarget(restriction.userId, tx)
    unwrap(authorizeModeration({ actor, target }))

    if (restriction.revokedAt !== null) return target

    await tx
      .update(userRestrictions)
      .set({ revokedAt: now, revokedByUserId: actor.id, revokeReason: reason.trim() })
      .where(eq(userRestrictions.id, restrictionId))

    await syncStatus(restriction.userId, now, tx)

    await recordAudit(
      {
        guildId: restriction.guildId,
        actorUserId: actor.id,
        action: 'member.unrestrict',
        entityType: 'user_restriction',
        entityId: restrictionId,
        before: { type: restriction.type, reason: restriction.reason },
        after: { revokedAt: now, reason },
      },
      tx,
    )

    return target
  })

  const remaining = await loadRestrictions(target.id)
  const stillBanned = remaining.some(
    (r) =>
      (r.type === 'BAN' || r.type === 'SUSPENSION') &&
      r.revokedAt === null &&
      (r.expiresAt === null || r.expiresAt.getTime() > now.getTime()),
  )
  if (!stillBanned) {
    try {
      await adminSetBan(target.supabaseUserId, 0)
    } catch (error) {
      console.error('[moderation] failed to lift the Supabase Auth ban', error)
    }
  }
}

/**
 * Permanently removes access.
 *
 * The row is kept and the ledger untouched, because deleting a member would
 * silently rewrite event history and every audit entry that references them.
 * What is removed is the ability to authenticate, now and in future.
 */
export async function revokeAccessPermanently(params: {
  actor: Actor
  userId: string
  reason: string
  now: Date
}): Promise<void> {
  const { actor, userId, reason, now } = params
  if (reason.trim().length < 5) {
    throw new AppError('REASON_REQUIRED', 'A detailed reason is required to permanently revoke access')
  }

  const target = await db.transaction(async (tx) => {
    const target = await loadTarget(userId, tx)
    unwrap(authorizeModeration({ actor, target }))

    await tx
      .update(users)
      .set({
        status: 'DELETED',
        isActive: false,
        deletedAt: now,
        deletedByUserId: actor.id,
        updatedAt: now,
      })
      .where(eq(users.id, userId))

    // Their characters stop being selectable anywhere.
    await tx.update(characters).set({ isActive: false, updatedAt: now }).where(eq(characters.userId, userId))

    // Live market listings are withdrawn. The comment used to promise this
    // while nothing did it, so a permanently revoked member kept advertising
    // to a guild they can no longer be reached in. Points and history stay.
    await tx
      .update(marketListings)
      .set({ status: 'CANCELLED', updatedAt: now })
      .where(
        and(
          eq(marketListings.sellerUserId, userId),
          inArray(marketListings.status, ['ACTIVE', 'RESERVED']),
        ),
      )

    await tx.insert(userRestrictions).values({
      guildId: target.guildId,
      userId,
      type: 'BAN',
      reason: `Access permanently revoked: ${reason.trim()}`,
      startsAt: now,
      expiresAt: null,
      createdByUserId: actor.id,
    })

    await recordAudit(
      {
        guildId: target.guildId,
        actorUserId: actor.id,
        action: 'member.revoke_access',
        entityType: 'user',
        entityId: userId,
        before: { status: target.status, isActive: target.isActive },
        after: { status: 'DELETED', reason },
      },
      tx,
    )

    return target
  })

  try {
    await adminSetBan(target.supabaseUserId, PERMANENT_BAN_HOURS)
  } catch (error) {
    console.error('[moderation] failed to mirror permanent revocation to Supabase Auth', error)
  }
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export async function changeMemberRole(params: {
  actor: Actor
  userId: string
  newRole: UserRole
  reason: string
  now: Date
}): Promise<void> {
  const { actor, userId, newRole, reason, now } = params

  await db.transaction(async (tx) => {
    const target = await loadTarget(userId, tx)
    unwrap(authorizeRoleChange({ actor, target, newRole }))

    if (target.deletedAt !== null) {
      throw new AppError('ACCOUNT_DELETED', 'This account has been permanently revoked')
    }
    if (target.role === newRole) return

    await tx.update(users).set({ role: newRole, updatedAt: now }).where(eq(users.id, userId))

    await recordAudit(
      {
        guildId: target.guildId,
        actorUserId: actor.id,
        action: 'member.change_role',
        entityType: 'user',
        entityId: userId,
        before: { role: target.role },
        after: { role: newRole, reason },
      },
      tx,
    )
  })
}

// ---------------------------------------------------------------------------
// Admin read models
// ---------------------------------------------------------------------------

/** The member roster: who they are, their characters' levels, and their points. */
export async function listMembers(actor: Actor) {
  unwrap(authorizeAdminAction(actor, actor.guildId))

  return db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      status: users.status,
      isActive: users.isActive,
      deletedAt: users.deletedAt,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      mainCharacterName: sql<string | null>`(
        select ${characters.name} from ${characters}
        where ${characters.userId} = ${users.id} and ${characters.kind} = 'MAIN'
        limit 1
      )`,
      mainCharacterLevel: sql<number | null>`(
        select ${characters.level} from ${characters}
        where ${characters.userId} = ${users.id} and ${characters.kind} = 'MAIN'
        limit 1
      )`,
      characterCount: sql<number>`(
        select count(*)::int from ${characters} where ${characters.userId} = ${users.id}
      )`,
      registrationCount: sql<number>`(
        select count(*)::int from ${eventRegistrations}
        where ${eventRegistrations.userId} = ${users.id}
          and ${eventRegistrations.status} <> 'REVERSED'
      )`,
      pendingPoints: sql<number>`(
        select coalesce(sum(${pointLedger.amount}), 0)::int from ${pointLedger}
        where ${pointLedger.userId} = ${users.id} and ${pointLedger.state} = 'PENDING'
      )`,
      availablePoints: sql<number>`(
        select coalesce(sum(${pointLedger.amount}), 0)::int from ${pointLedger}
        where ${pointLedger.userId} = ${users.id} and ${pointLedger.state} = 'CONFIRMED'
      )`,
      activeRestrictions: sql<number>`(
        select count(*)::int from ${userRestrictions}
        where ${userRestrictions.userId} = ${users.id}
          and ${userRestrictions.revokedAt} is null
          and (${userRestrictions.expiresAt} is null or ${userRestrictions.expiresAt} > now())
      )`,
    })
    .from(users)
    .where(eq(users.guildId, actor.guildId))
    .orderBy(desc(users.createdAt))
    .limit(500)
}

export async function listActiveRestrictions(actor: Actor) {
  unwrap(authorizeAdminAction(actor, actor.guildId))

  return db
    .select({
      id: userRestrictions.id,
      userId: userRestrictions.userId,
      email: users.email,
      type: userRestrictions.type,
      reason: userRestrictions.reason,
      startsAt: userRestrictions.startsAt,
      expiresAt: userRestrictions.expiresAt,
      createdByUserId: userRestrictions.createdByUserId,
    })
    .from(userRestrictions)
    .innerJoin(users, eq(users.id, userRestrictions.userId))
    .where(
      and(
        eq(userRestrictions.guildId, actor.guildId),
        isNull(userRestrictions.revokedAt),
      ),
    )
    .orderBy(desc(userRestrictions.createdAt))
    .limit(200)
}
