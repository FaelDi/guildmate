import 'server-only'

import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import { pointLedger, users } from '@/db/schema'
import { recordAudit } from '@/lib/audit'
import { AppError, unwrap } from '@/lib/errors'
import { evaluatePenalty, evaluatePenaltyReversal, type Actor } from '@/lib/rules'
import { appendLedger } from './points'

/**
 * Penalties are ledger rows like everything else that moves a balance: a
 * PENALTY is negative and CONFIRMED the moment it is written, and its reversal
 * is one PENALTY_REVERSAL row pointing back at it through `ref_id`.
 */

const uuidSchema = z.string().uuid()

function assertUuid(value: string): string {
  if (!uuidSchema.safeParse(value).success) {
    throw new AppError('FORBIDDEN', 'You are not allowed to access this resource', 403)
  }
  return value
}

export async function applyPenalty(params: {
  actor: Actor
  userId: string
  points: number
  reason: string
}): Promise<{ id: string }> {
  const { actor } = params
  const userId = assertUuid(params.userId)

  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: users.id, guildId: users.guildId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    if (!target) throw new AppError('FORBIDDEN', 'You are not allowed to access this resource', 403)

    const plan = unwrap(
      evaluatePenalty({ actor, target, points: params.points, reason: params.reason }),
    )

    const id = await appendLedger(
      {
        guildId: target.guildId,
        userId: target.id,
        characterId: null,
        kind: 'PENALTY',
        state: 'CONFIRMED',
        amount: plan.amount,
        reason: plan.reason,
        refType: 'penalty',
        createdByUserId: actor.id,
      },
      tx,
    )

    await recordAudit(
      {
        guildId: target.guildId,
        actorUserId: actor.id,
        action: 'points.penalty',
        entityType: 'point_ledger',
        entityId: id,
        after: { userId: target.id, amount: plan.amount, reason: plan.reason },
      },
      tx,
    )

    return { id }
  })
}

export async function reversePenalty(params: { actor: Actor; penaltyId: string }): Promise<void> {
  const { actor } = params
  const penaltyId = assertUuid(params.penaltyId)

  await db.transaction(async (tx) => {
    // The lock serialises two admins reversing the same penalty: the second
    // one reads the first one's reversal row and is refused.
    const [penalty] = await tx
      .select()
      .from(pointLedger)
      .where(eq(pointLedger.id, penaltyId))
      .limit(1)
      .for('update')
    if (!penalty || penalty.guildId !== actor.guildId) {
      throw new AppError('NOT_FOUND', 'Penalty not found', 404)
    }

    const [existing] = await tx
      .select({ id: pointLedger.id })
      .from(pointLedger)
      .where(
        and(
          eq(pointLedger.kind, 'PENALTY_REVERSAL'),
          eq(pointLedger.refType, 'penalty'),
          eq(pointLedger.refId, penaltyId),
        ),
      )
      .limit(1)

    const plan = unwrap(
      evaluatePenaltyReversal({ actor, penalty, alreadyReversed: existing !== undefined }),
    )

    const id = await appendLedger(
      {
        guildId: penalty.guildId,
        userId: penalty.userId,
        characterId: null,
        kind: 'PENALTY_REVERSAL',
        state: 'CONFIRMED',
        amount: plan.amount,
        reason: `Penalty reversed: ${penalty.reason}`,
        refType: 'penalty',
        refId: penalty.id,
        createdByUserId: actor.id,
      },
      tx,
    )

    await recordAudit(
      {
        guildId: penalty.guildId,
        actorUserId: actor.id,
        action: 'points.penalty_reverse',
        entityType: 'point_ledger',
        entityId: id,
        before: { penaltyId: penalty.id, amount: penalty.amount },
        after: { amount: plan.amount },
      },
      tx,
    )
  })
}

/** Net penalties per member: what they lost, minus what was given back. */
export async function getGuildPenaltyTotals(guildId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({
      userId: pointLedger.userId,
      total: sql<number>`coalesce(-sum(${pointLedger.amount}), 0)::int`,
    })
    .from(pointLedger)
    .where(
      and(
        eq(pointLedger.guildId, guildId),
        sql`${pointLedger.kind} in ('PENALTY', 'PENALTY_REVERSAL')`,
      ),
    )
    .groupBy(pointLedger.userId)

  return new Map(rows.map((r) => [r.userId, Number(r.total)]))
}

/** Recent penalties with whether each was reversed, for the admin panel. */
export async function listPenalties(guildId: string, limit = 100) {
  const reversals = db
    .select({ refId: pointLedger.refId })
    .from(pointLedger)
    .where(and(eq(pointLedger.guildId, guildId), eq(pointLedger.kind, 'PENALTY_REVERSAL')))

  return db
    .select({
      id: pointLedger.id,
      userId: pointLedger.userId,
      amount: pointLedger.amount,
      reason: pointLedger.reason,
      createdAt: pointLedger.createdAt,
      reversed: sql<boolean>`${pointLedger.id} in (${reversals})`,
    })
    .from(pointLedger)
    .where(and(eq(pointLedger.guildId, guildId), eq(pointLedger.kind, 'PENALTY')))
    .orderBy(desc(pointLedger.createdAt))
    .limit(limit)
}
