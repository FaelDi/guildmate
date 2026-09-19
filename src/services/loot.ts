import 'server-only'

import { randomUUID, webcrypto } from 'node:crypto'
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db, type Executor, type Transaction } from '@/db'
import { characters, guildWeeks, lootBanners, lootBets, lootItems, users } from '@/db/schema'
import { recordAudit } from '@/lib/audit'
import { AppError, unwrap } from '@/lib/errors'
import {
  authorizeAdminAction,
  buildLootWheel,
  evaluateBannerExtend,
  evaluateBetWithdrawal,
  evaluateLootBannerCreate,
  evaluateLootBet,
  evaluateLootDraw,
  pickWheelSlice,
  type Actor,
  type LootItemDraft,
  type RestrictionLike,
  type SettingsLike,
  type WheelSlice,
} from '@/lib/rules'
import { appendLedger, getBalance } from './points'
import { getMemberParticipation } from './weeks'

/**
 * The loot raffle.
 *
 * Money flow, all inside the ledger:
 *   bet placed   -> LOOT_HOLD    (-points, CONFIRMED)  the points are locked
 *   bet loses    -> LOOT_RELEASE (+points, CONFIRMED)  they come back
 *   bet withdrawn-> LOOT_RELEASE (+points, CONFIRMED)
 *   bet wins     -> nothing: the hold IS the price.
 * No path writes a positive row that is not the mirror of an earlier hold.
 */

const uuidSchema = z.string().uuid()

function assertUuid(value: string, code = 'NOT_FOUND', message = 'Not found'): string {
  if (!uuidSchema.safeParse(value).success) throw new AppError(code, message, 404)
  return value
}

export const createBannerSchema = z.object({
  title: z.string().max(200),
  durationHours: z.number().int().nullable(),
  items: z
    .array(
      z.object({
        name: z.string().max(200),
        maxPoints: z.number(),
        restriction: z.enum(['ALL', 'TITAN', 'MEGA']),
      }),
    )
    .max(50),
})

export type CreateBannerInput = z.infer<typeof createBannerSchema>

/** A uniform roll in [0, 1) from the CSPRNG. Math.random is not a raffle. */
function secureRoll(): number {
  const buffer = new Uint32Array(1)
  webcrypto.getRandomValues(buffer)
  return (buffer[0] ?? 0) / 2 ** 32
}

async function hasOpenBanner(guildId: string, executor: Executor): Promise<boolean> {
  const [row] = await executor
    .select({ id: lootBanners.id })
    .from(lootBanners)
    .where(and(eq(lootBanners.guildId, guildId), eq(lootBanners.status, 'OPEN')))
    .limit(1)
  return row !== undefined
}

export async function createBanner(params: {
  actor: Actor
  input: CreateBannerInput
  now: Date
}): Promise<{ id: string }> {
  const { actor, now } = params
  const input = createBannerSchema.parse(params.input)

  try {
    return await db.transaction(async (tx) => {
      const plan = unwrap(
        evaluateLootBannerCreate({
          actor,
          guildId: actor.guildId,
          title: input.title,
          durationHours: input.durationHours,
          items: input.items as LootItemDraft[],
          hasOpenBanner: await hasOpenBanner(actor.guildId, tx),
          now,
        }),
      )

      const [banner] = await tx
        .insert(lootBanners)
        .values({
          guildId: actor.guildId,
          title: plan.title,
          closesAt: plan.closesAt,
          createdByUserId: actor.id,
        })
        .returning({ id: lootBanners.id })
      if (!banner) throw new AppError('INTERNAL_ERROR', 'Failed to publish the banner', 500)

      await tx.insert(lootItems).values(
        plan.items.map((item) => ({
          bannerId: banner.id,
          guildId: actor.guildId,
          name: item.name,
          maxPoints: item.maxPoints,
          restriction: item.restriction,
        })),
      )

      await recordAudit(
        {
          guildId: actor.guildId,
          actorUserId: actor.id,
          action: 'loot.banner_create',
          entityType: 'loot_banner',
          entityId: banner.id,
          after: { title: plan.title, closesAt: plan.closesAt, items: plan.items },
        },
        tx,
      )

      return { id: banner.id }
    })
  } catch (error) {
    // The partial unique index is the last word on "one open banner".
    if (isUniqueViolation(error)) {
      throw new AppError('BANNER_ALREADY_OPEN', 'Close the current loot banner before publishing another', 409)
    }
    throw error
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505'
}

async function loadBannerForUpdate(bannerId: string, actor: Actor, tx: Transaction) {
  const [banner] = await tx
    .select()
    .from(lootBanners)
    .where(eq(lootBanners.id, assertUuid(bannerId)))
    .limit(1)
    .for('update')
  if (!banner || banner.guildId !== actor.guildId) throw new AppError('NOT_FOUND', 'Not found', 404)
  return banner
}

export async function extendBanner(params: {
  actor: Actor
  bannerId: string
  hours: number
  now: Date
}): Promise<void> {
  const { actor, hours, now } = params

  await db.transaction(async (tx) => {
    const banner = await loadBannerForUpdate(params.bannerId, actor, tx)
    const plan = unwrap(evaluateBannerExtend({ actor, banner, hours, now }))

    await tx.update(lootBanners).set({ closesAt: plan.closesAt }).where(eq(lootBanners.id, banner.id))

    await recordAudit(
      {
        guildId: actor.guildId,
        actorUserId: actor.id,
        action: 'loot.banner_extend',
        entityType: 'loot_banner',
        entityId: banner.id,
        before: { closesAt: banner.closesAt },
        after: { closesAt: plan.closesAt },
      },
      tx,
    )
  })
}

/** Releases one ACTIVE bet: the mirror LOOT_RELEASE row, then the status. */
async function releaseBet(
  bet: { id: string; guildId: string; userId: string; characterId: string; points: number },
  reason: string,
  actorUserId: string | null,
  now: Date,
  tx: Transaction,
): Promise<void> {
  await appendLedger(
    {
      guildId: bet.guildId,
      userId: bet.userId,
      characterId: bet.characterId,
      kind: 'LOOT_RELEASE',
      state: 'CONFIRMED',
      amount: bet.points,
      reason,
      refType: 'loot_bet',
      refId: bet.id,
      createdByUserId: actorUserId,
    },
    tx,
  )
  await tx
    .update(lootBets)
    .set({ status: 'RELEASED', settledAt: now })
    .where(and(eq(lootBets.id, bet.id), eq(lootBets.status, 'ACTIVE')))
}

/**
 * Closing a banner. Anything not drawn yet is cancelled and every bet on it
 * handed back, so no points stay locked on a wheel that will never spin.
 */
export async function closeBanner(params: { actor: Actor; bannerId: string; now: Date }): Promise<void> {
  const { actor, now } = params

  await db.transaction(async (tx) => {
    const banner = await loadBannerForUpdate(params.bannerId, actor, tx)
    unwrap(authorizeAdminAction(actor, banner.guildId))
    if (banner.status === 'CLOSED') return

    const openItems = await tx
      .select({ id: lootItems.id })
      .from(lootItems)
      .where(and(eq(lootItems.bannerId, banner.id), eq(lootItems.status, 'OPEN')))
      .limit(50)
      .for('update')

    const itemIds = openItems.map((i) => i.id)
    if (itemIds.length > 0) {
      const active = await tx
        .select()
        .from(lootBets)
        .where(and(inArray(lootBets.itemId, itemIds), eq(lootBets.status, 'ACTIVE')))
        .orderBy(asc(lootBets.id))
        .limit(5000)
        .for('update')

      for (const bet of active) {
        await releaseBet(bet, `Loot banner closed: ${banner.title}`, actor.id, now, tx)
      }
      await tx.update(lootItems).set({ status: 'CANCELLED' }).where(inArray(lootItems.id, itemIds))
    }

    await tx
      .update(lootBanners)
      .set({ status: 'CLOSED', closedAt: now })
      .where(eq(lootBanners.id, banner.id))

    await recordAudit(
      {
        guildId: actor.guildId,
        actorUserId: actor.id,
        action: 'loot.banner_close',
        entityType: 'loot_banner',
        entityId: banner.id,
        after: { cancelledItems: itemIds.length },
      },
      tx,
    )
  })
}

/**
 * Placing a bet with the caller's MAIN. The character is never taken from the
 * form: an account has exactly one MAIN, so there is nothing to choose and
 * nothing to forge.
 */
export async function placeBet(params: {
  actor: Actor
  restrictions: readonly RestrictionLike[]
  settings: SettingsLike
  itemId: string
  points: number
  now: Date
}): Promise<{ id: string }> {
  const { actor, restrictions, settings, points, now } = params
  const itemId = assertUuid(params.itemId)

  try {
    return await db.transaction(async (tx) => {
      // Serialise every bet of this account: two bets racing on two items
      // must not both be funded by the same balance.
      await tx.select({ id: users.id }).from(users).where(eq(users.id, actor.id)).for('update')

      const [item] = await tx
        .select()
        .from(lootItems)
        .where(eq(lootItems.id, itemId))
        .limit(1)
        .for('update')
      if (!item || item.guildId !== actor.guildId) throw new AppError('NOT_FOUND', 'Not found', 404)

      const [banner] = await tx
        .select()
        .from(lootBanners)
        .where(eq(lootBanners.id, item.bannerId))
        .limit(1)
      if (!banner) throw new AppError('NOT_FOUND', 'Not found', 404)

      const [main] = await tx
        .select()
        .from(characters)
        .where(and(eq(characters.userId, actor.id), eq(characters.kind, 'MAIN')))
        .limit(1)
      if (!main) {
        throw new AppError('MAIN_CHARACTER_REQUIRED', 'Only a main character can bet on loot')
      }

      const [existing] = await tx
        .select({ id: lootBets.id })
        .from(lootBets)
        .where(
          and(eq(lootBets.itemId, item.id), eq(lootBets.userId, actor.id), eq(lootBets.status, 'ACTIVE')),
        )
        .limit(1)

      const [balance, participationPct] = await Promise.all([
        getBalance(actor.id, tx),
        getMemberParticipation({ guildId: actor.guildId, userId: actor.id }, tx),
      ])

      const plan = unwrap(
        evaluateLootBet({
          actor,
          restrictions,
          character: main,
          banner,
          item,
          participationPct,
          settings,
          availablePoints: balance.available,
          hasActiveBet: existing !== undefined,
          points,
          now,
        }),
      )

      const betId = randomUUID()
      const holdLedgerId = await appendLedger(
        {
          guildId: actor.guildId,
          userId: actor.id,
          characterId: main.id,
          kind: 'LOOT_HOLD',
          state: 'CONFIRMED',
          amount: -plan.points,
          reason: `Loot bet: ${item.name}`,
          refType: 'loot_bet',
          refId: betId,
          createdByUserId: actor.id,
        },
        tx,
      )

      await tx.insert(lootBets).values({
        id: betId,
        itemId: item.id,
        guildId: actor.guildId,
        userId: actor.id,
        characterId: main.id,
        points: plan.points,
        holdLedgerId,
      })

      await recordAudit(
        {
          guildId: actor.guildId,
          actorUserId: actor.id,
          action: 'loot.bet',
          entityType: 'loot_bet',
          entityId: betId,
          after: { itemId: item.id, points: plan.points },
        },
        tx,
      )

      return { id: betId }
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError('ALREADY_BET', 'You already have a bet on this item', 409)
    }
    throw error
  }
}

export async function withdrawBet(params: { actor: Actor; betId: string; now: Date }): Promise<void> {
  const { actor, now } = params
  const betId = assertUuid(params.betId)

  await db.transaction(async (tx) => {
    const [bet] = await tx.select().from(lootBets).where(eq(lootBets.id, betId)).limit(1).for('update')
    if (!bet || bet.guildId !== actor.guildId) throw new AppError('NOT_FOUND', 'Not found', 404)

    const [item] = await tx.select().from(lootItems).where(eq(lootItems.id, bet.itemId)).limit(1)
    const [banner] = item
      ? await tx.select().from(lootBanners).where(eq(lootBanners.id, item.bannerId)).limit(1)
      : []
    if (!item || !banner) throw new AppError('NOT_FOUND', 'Not found', 404)

    const { viaAdmin } = unwrap(evaluateBetWithdrawal({ actor, bet, item, banner, now }))

    await releaseBet(bet, `Loot bet withdrawn: ${item.name}`, actor.id, now, tx)

    await recordAudit(
      {
        guildId: actor.guildId,
        actorUserId: actor.id,
        action: viaAdmin ? 'loot.bet_withdraw_by_admin' : 'loot.bet_withdraw',
        entityType: 'loot_bet',
        entityId: bet.id,
        before: { points: bet.points, userId: bet.userId },
      },
      tx,
    )
  })
}

export type DrawResult = {
  itemName: string
  slices: WheelSlice[]
  winnerIndex: number
  winnerLabel: string
  staffWon: boolean
  pointsPaid: number
}

/**
 * The draw. The roll comes from the CSPRNG, the wheel is persisted as it was,
 * and every bet is settled before the transaction commits - so the result
 * cannot be re-rolled, and every viewer replays the same wheel.
 */
export async function drawItem(params: {
  actor: Actor
  settings: SettingsLike
  itemId: string
  staffUserId: string | null
  now: Date
}): Promise<DrawResult> {
  const { actor, settings, now } = params
  const itemId = assertUuid(params.itemId)
  const staffUserId =
    params.staffUserId === null || params.staffUserId === ''
      ? null
      : assertUuid(params.staffUserId, 'INVALID_STAFF', 'The staff slice must belong to an admin')

  return db.transaction(async (tx) => {
    const [item] = await tx.select().from(lootItems).where(eq(lootItems.id, itemId)).limit(1).for('update')
    if (!item || item.guildId !== actor.guildId) throw new AppError('NOT_FOUND', 'Not found', 404)

    const bets = await tx
      .select({
        id: lootBets.id,
        guildId: lootBets.guildId,
        userId: lootBets.userId,
        characterId: lootBets.characterId,
        points: lootBets.points,
        label: characters.name,
      })
      .from(lootBets)
      .innerJoin(characters, eq(characters.id, lootBets.characterId))
      .where(and(eq(lootBets.itemId, item.id), eq(lootBets.status, 'ACTIVE')))
      .orderBy(asc(lootBets.createdAt), asc(lootBets.id))
      .limit(1000)
      .for('update', { of: lootBets })

    let staff: { id: string; guildId: string; role: Actor['role']; label: string } | null = null
    if (staffUserId !== null) {
      const [row] = await tx
        .select({ id: users.id, guildId: users.guildId, role: users.role, label: characters.name })
        .from(users)
        .leftJoin(characters, and(eq(characters.userId, users.id), eq(characters.kind, 'MAIN')))
        .where(eq(users.id, staffUserId))
        .limit(1)
      if (!row) throw new AppError('INVALID_STAFF', 'The staff slice must belong to an admin of this guild')
      staff = { ...row, label: row.label ?? 'Staff' }
    }

    unwrap(evaluateLootDraw({ actor, item, bets, staff }))

    const slices = buildLootWheel({
      bets,
      staffLabel: staff?.label ?? null,
      staffSharePct: settings.lootStaffSharePct,
    })
    const winner = pickWheelSlice(slices, secureRoll())
    if (!winner) throw new AppError('NO_BETS', 'Nobody has bet on this item yet')
    const winnerIndex = slices.indexOf(winner)
    const winningBet = winner.kind === 'BET' ? bets.find((b) => b.id === winner.betId) : undefined

    for (const bet of bets) {
      if (winningBet && bet.id === winningBet.id) {
        await tx
          .update(lootBets)
          .set({ status: 'WON', settledAt: now })
          .where(eq(lootBets.id, bet.id))
      } else {
        await releaseBet(bet, `Loot bet lost: ${item.name}`, actor.id, now, tx)
      }
    }

    await tx
      .update(lootItems)
      .set({
        status: 'DRAWN',
        winnerUserId: winningBet?.userId ?? null,
        winnerCharacterId: winningBet?.characterId ?? null,
        winnerName: winner.label,
        staffName: winner.kind === 'STAFF' ? winner.label : null,
        pointsPaid: winningBet?.points ?? 0,
        drawSlices: { slices, winnerIndex },
        drawnAt: now,
        drawnByUserId: actor.id,
      })
      .where(eq(lootItems.id, item.id))

    await recordAudit(
      {
        guildId: actor.guildId,
        actorUserId: actor.id,
        action: 'loot.draw',
        entityType: 'loot_item',
        entityId: item.id,
        after: {
          winner: winner.label,
          staffWon: winner.kind === 'STAFF',
          pointsPaid: winningBet?.points ?? 0,
          bets: bets.length,
        },
      },
      tx,
    )

    return {
      itemName: item.name,
      slices,
      winnerIndex,
      winnerLabel: winner.label,
      staffWon: winner.kind === 'STAFF',
      pointsPaid: winningBet?.points ?? 0,
    }
  })
}

/**
 * Hands back every live bet of an account whose access was revoked, inside
 * the revocation's own transaction.
 */
export async function releaseActiveBetsForUser(
  userId: string,
  actorUserId: string,
  now: Date,
  tx: Transaction,
): Promise<number> {
  const active = await tx
    .select()
    .from(lootBets)
    .where(and(eq(lootBets.userId, userId), eq(lootBets.status, 'ACTIVE')))
    .orderBy(asc(lootBets.id))
    .limit(100)
    .for('update')

  for (const bet of active) {
    await releaseBet(bet, 'Loot bet released: access revoked', actorUserId, now, tx)
  }
  return active.length
}

export async function updateLootNote(params: {
  actor: Actor
  itemId: string
  note: string
}): Promise<void> {
  const { actor } = params
  const itemId = assertUuid(params.itemId)
  const note = params.note.trim().slice(0, 200)

  await db.transaction(async (tx) => {
    const [item] = await tx.select().from(lootItems).where(eq(lootItems.id, itemId)).limit(1).for('update')
    if (!item || item.guildId !== actor.guildId) throw new AppError('NOT_FOUND', 'Not found', 404)
    unwrap(authorizeAdminAction(actor, item.guildId))

    await tx.update(lootItems).set({ note: note.length > 0 ? note : null }).where(eq(lootItems.id, itemId))
    await recordAudit(
      {
        guildId: actor.guildId,
        actorUserId: actor.id,
        action: 'loot.note',
        entityType: 'loot_item',
        entityId: itemId,
        before: { note: item.note },
        after: { note },
      },
      tx,
    )
  })
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type OpenBannerView = {
  id: string
  title: string
  closesAt: Date | null
  items: {
    id: string
    name: string
    maxPoints: number
    restriction: 'ALL' | 'TITAN' | 'MEGA'
    status: 'OPEN' | 'DRAWN' | 'CANCELLED'
    winnerName: string | null
    pointsPaid: number
    bets: { id: string; userId: string; characterName: string; points: number }[]
  }[]
}

export async function getOpenBanner(guildId: string): Promise<OpenBannerView | null> {
  const [banner] = await db
    .select()
    .from(lootBanners)
    .where(and(eq(lootBanners.guildId, guildId), eq(lootBanners.status, 'OPEN')))
    .limit(1)
  if (!banner) return null

  const items = await db
    .select()
    .from(lootItems)
    .where(eq(lootItems.bannerId, banner.id))
    .orderBy(asc(lootItems.createdAt), asc(lootItems.id))
    .limit(50)

  const itemIds = items.map((i) => i.id)
  const bets =
    itemIds.length === 0
      ? []
      : await db
          .select({
            id: lootBets.id,
            itemId: lootBets.itemId,
            userId: lootBets.userId,
            characterName: characters.name,
            points: lootBets.points,
          })
          .from(lootBets)
          .innerJoin(characters, eq(characters.id, lootBets.characterId))
          .where(and(inArray(lootBets.itemId, itemIds), eq(lootBets.status, 'ACTIVE')))
          .orderBy(desc(lootBets.points))
          .limit(2000)

  return {
    id: banner.id,
    title: banner.title,
    closesAt: banner.closesAt,
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      maxPoints: item.maxPoints,
      restriction: item.restriction,
      status: item.status,
      winnerName: item.winnerName,
      pointsPaid: item.pointsPaid,
      bets: bets
        .filter((b) => b.itemId === item.id)
        .map(({ id, userId, characterName, points }) => ({ id, userId, characterName, points })),
    })),
  }
}

/** "Registro de Espolios": every drawn item, with the week it fell in. */
export async function listLootHistory(guildId: string, limit = 200) {
  return db
    .select({
      id: lootItems.id,
      name: lootItems.name,
      winnerName: lootItems.winnerName,
      staffName: lootItems.staffName,
      pointsPaid: lootItems.pointsPaid,
      drawnAt: lootItems.drawnAt,
      note: lootItems.note,
      weekNumber: sql<number | null>`(
        select max(${guildWeeks.number}) from ${guildWeeks}
        where ${guildWeeks.guildId} = ${lootItems.guildId}
          and ${guildWeeks.startedAt} <= ${lootItems.drawnAt}
      )`,
    })
    .from(lootItems)
    .where(and(eq(lootItems.guildId, guildId), eq(lootItems.status, 'DRAWN')))
    .orderBy(desc(lootItems.drawnAt))
    .limit(limit)
}

/** The draw that just happened, so every open screen can replay the wheel. */
export async function getRecentDraw(guildId: string, now: Date, windowSeconds = 45) {
  const [row] = await db
    .select({
      id: lootItems.id,
      name: lootItems.name,
      drawSlices: lootItems.drawSlices,
      drawnAt: lootItems.drawnAt,
      winnerName: lootItems.winnerName,
      pointsPaid: lootItems.pointsPaid,
    })
    .from(lootItems)
    .where(
      and(
        eq(lootItems.guildId, guildId),
        eq(lootItems.status, 'DRAWN'),
        gte(lootItems.drawnAt, new Date(now.getTime() - windowSeconds * 1000)),
      ),
    )
    .orderBy(desc(lootItems.drawnAt))
    .limit(1)
  return row ?? null
}

/** Admins' MAIN characters: who the staff slice can belong to. */
export async function listStaffCandidates(guildId: string) {
  return db
    .select({ userId: users.id, name: characters.name })
    .from(users)
    .innerJoin(characters, and(eq(characters.userId, users.id), eq(characters.kind, 'MAIN')))
    .where(
      and(
        eq(users.guildId, guildId),
        eq(users.isActive, true),
        inArray(users.role, ['VICE_LEADER', 'LEADER', 'SUPER_ADMIN']),
      ),
    )
    .orderBy(asc(characters.name))
    .limit(50)
}
