import { and, eq, sql } from 'drizzle-orm'
import { db, type Executor } from '@/db'
import { pointLedger } from '@/db/schema'
import { computeBalance, type Balance } from '@/lib/rules'

/**
 * Balances are always aggregated from the ledger. There is deliberately no
 * cached total column: a reversal or a re-scoring can never leave a stale
 * number behind if there is no number to go stale.
 */
export async function getBalance(userId: string, executor: Executor = db): Promise<Balance> {
  const rows = await executor
    .select({
      state: pointLedger.state,
      total: sql<number>`coalesce(sum(${pointLedger.amount}), 0)::int`,
    })
    .from(pointLedger)
    .where(eq(pointLedger.userId, userId))
    .groupBy(pointLedger.state)

  return computeBalance(rows.map((r) => ({ state: r.state, amount: Number(r.total) })))
}

export type LeaderboardRow = {
  userId: string
  pending: number
  available: number
}

/** Guild-wide standings, derived from the same ledger the balances come from. */
export async function getLeaderboard(guildId: string, limit = 50): Promise<LeaderboardRow[]> {
  const rows = await db
    .select({
      userId: pointLedger.userId,
      pending: sql<number>`coalesce(sum(${pointLedger.amount}) filter (where ${pointLedger.state} = 'PENDING'), 0)::int`,
      available: sql<number>`coalesce(sum(${pointLedger.amount}) filter (where ${pointLedger.state} = 'CONFIRMED'), 0)::int`,
    })
    .from(pointLedger)
    .where(eq(pointLedger.guildId, guildId))
    .groupBy(pointLedger.userId)
    .orderBy(
      sql`coalesce(sum(${pointLedger.amount}) filter (where ${pointLedger.state} = 'CONFIRMED'), 0) desc`,
    )
    .limit(limit)

  return rows.map((r) => ({
    userId: r.userId,
    pending: Number(r.pending),
    available: Number(r.available),
  }))
}

export type LedgerWrite = {
  guildId: string
  userId: string
  characterId: string | null
  kind: (typeof pointLedger.$inferInsert)['kind']
  state: 'PENDING' | 'CONFIRMED'
  amount: number
  reason: string
  refType?: string | null
  refId?: string | null
  eventId?: string | null
  createdByUserId?: string | null
}

/** The only way points are ever created. Returns the new row id. */
export async function appendLedger(entry: LedgerWrite, executor: Executor): Promise<string> {
  const [row] = await executor
    .insert(pointLedger)
    .values({
      guildId: entry.guildId,
      userId: entry.userId,
      characterId: entry.characterId,
      kind: entry.kind,
      state: entry.state,
      amount: entry.amount,
      reason: entry.reason,
      refType: entry.refType ?? null,
      refId: entry.refId ?? null,
      eventId: entry.eventId ?? null,
      createdByUserId: entry.createdByUserId ?? null,
      stateChangedAt: new Date(),
    })
    .returning({ id: pointLedger.id })

  if (!row) throw new Error('Failed to append the ledger entry')
  return row.id
}

/** Promotes every pending award of an event to spendable. */
export async function confirmEventLedger(eventId: string, executor: Executor): Promise<void> {
  await executor
    .update(pointLedger)
    .set({ state: 'CONFIRMED', stateChangedAt: new Date() })
    .where(and(eq(pointLedger.eventId, eventId), eq(pointLedger.state, 'PENDING')))
}

/**
 * Voids every award of an event, pending or confirmed. Used when an event is
 * cancelled for missing quorum.
 */
export async function reverseEventLedger(eventId: string, executor: Executor): Promise<void> {
  await executor
    .update(pointLedger)
    .set({ state: 'REVERSED', stateChangedAt: new Date() })
    .where(and(eq(pointLedger.eventId, eventId), sql`${pointLedger.state} <> 'REVERSED'`))
}
