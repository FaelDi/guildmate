import 'server-only'

import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { characters, pointLedger, users } from '@/db/schema'
import type { BuildFlags } from '@/lib/rules'
import { getGuildPenaltyTotals } from './penalties'
import { getCurrentWeek, getGuildParticipation, type CurrentWeek } from './weeks'

/**
 * The shared board behind the ranking and the classes screens: one row per
 * active account, keyed by its MAIN. Built from four aggregate queries - no
 * N+1, and no ledger row ever leaves the database.
 */

const MAX_MEMBERS = 500

export type BoardRow = {
  userId: string
  mainId: string
  name: string
  biosuit: string
  level: number
  combatPower: number
  build: BuildFlags
  alts: { id: string; name: string }[]
  participation: number
  penalties: number
  /** Spendable points, active loot holds already deducted. */
  balance: number
}

export async function getGuildBoard(guildId: string): Promise<{ week: CurrentWeek; rows: BoardRow[] }> {
  const week = await getCurrentWeek(guildId)

  const [roster, balances, participation, penalties] = await Promise.all([
    db
      .select({
        id: characters.id,
        userId: characters.userId,
        name: characters.name,
        kind: characters.kind,
        biosuit: characters.biosuit,
        level: characters.level,
        combatPower: characters.combatPower,
        skill4: characters.skill4,
        skill5: characters.skill5,
        skill6: characters.skill6,
        skill7: characters.skill7,
        constant3: characters.constant3,
        painAdaptation: characters.painAdaptation,
        trinity: characters.trinity,
        techniqueMaster: characters.techniqueMaster,
      })
      .from(characters)
      .innerJoin(users, eq(users.id, characters.userId))
      .where(
        and(
          eq(characters.guildId, guildId),
          eq(characters.isActive, true),
          eq(users.isActive, true),
          sql`${users.deletedAt} is null`,
        ),
      )
      .orderBy(asc(characters.name))
      .limit(MAX_MEMBERS * 4),
    db
      .select({
        userId: pointLedger.userId,
        available: sql<number>`coalesce(sum(${pointLedger.amount}) filter (where ${pointLedger.state} = 'CONFIRMED'), 0)::int`,
      })
      .from(pointLedger)
      .where(eq(pointLedger.guildId, guildId))
      .groupBy(pointLedger.userId),
    getGuildParticipation(guildId, week),
    getGuildPenaltyTotals(guildId),
  ])

  const balanceByUser = new Map(balances.map((b) => [b.userId, Number(b.available)]))
  const altsByUser = new Map<string, { id: string; name: string }[]>()
  for (const c of roster) {
    if (c.kind !== 'ALT') continue
    const list = altsByUser.get(c.userId) ?? []
    list.push({ id: c.id, name: c.name })
    altsByUser.set(c.userId, list)
  }

  const rows: BoardRow[] = roster
    .filter((c) => c.kind === 'MAIN')
    .slice(0, MAX_MEMBERS)
    .map((c) => ({
      userId: c.userId,
      mainId: c.id,
      name: c.name,
      biosuit: c.biosuit,
      level: c.level,
      combatPower: c.combatPower,
      build: {
        skill4: c.skill4,
        skill5: c.skill5,
        skill6: c.skill6,
        skill7: c.skill7,
        constant3: c.constant3,
        painAdaptation: c.painAdaptation,
        trinity: c.trinity,
        techniqueMaster: c.techniqueMaster,
      },
      alts: altsByUser.get(c.userId) ?? [],
      participation: participation.get(c.userId) ?? 100,
      penalties: penalties.get(c.userId) ?? 0,
      balance: balanceByUser.get(c.userId) ?? 0,
    }))

  return { week, rows }
}

/** Ranking order: participation first, then combat power, then name. */
export function sortForRanking(rows: readonly BoardRow[]): BoardRow[] {
  return [...rows].sort(
    (a, b) =>
      b.participation - a.participation ||
      b.combatPower - a.combatPower ||
      a.name.localeCompare(b.name),
  )
}

/** Classes board order: combat power, then name. */
export function sortForClasses(rows: readonly BoardRow[]): BoardRow[] {
  return [...rows].sort((a, b) => b.combatPower - a.combatPower || a.name.localeCompare(b.name))
}
