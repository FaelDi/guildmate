import 'server-only'

import { and, desc, eq, inArray, lte } from 'drizzle-orm'
import { z } from 'zod'
import { db, type Executor } from '@/db'
import { auctionBids, auctions, characters, pointLedger } from '@/db/schema'
import { recordAudit } from '@/lib/audit'
import { AppError, unwrap } from '@/lib/errors'
import { loadRestrictions } from '@/lib/restrictions'
import {
  applyAntiSnipe,
  authorizeAdminAction,
  evaluateBid,
  minimumBid,
  type Actor,
  type CharacterLike,
  type SettingsLike,
} from '@/lib/rules'
import { appendLedger, getBalance } from './points'

/**
 * Admin-run item auctions, paid with event POINTS.
 *
 * A bid does not merely promise points, it locks them: an AUCTION_HOLD is a
 * negative ledger row, so the same points cannot back two simultaneous bids.
 * Being outbid appends a matching AUCTION_RELEASE. Winning simply leaves the
 * hold in place - that is the spend.
 */

export const createAuctionSchema = z.object({
  itemName: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional(),
  itemType: z.enum([
    'WEAPON', 'ARMOR', 'SHIELD', 'HELMET', 'GLOVES', 'BOOTS',
    'ACCESSORY', 'BIOSUIT', 'MATERIAL', 'CONSUMABLE', 'OTHER',
  ]),
  rarity: z.enum(['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY']),
  itemLevel: z.number().int().min(1).max(999),
  startingBid: z.number().int().min(1).max(10_000_000),
  minIncrement: z.number().int().min(1).max(1_000_000),
  durationMinutes: z.number().int().min(5).max(20_160),
})

export async function createAuction(params: {
  actor: Actor
  input: z.infer<typeof createAuctionSchema>
  now: Date
}): Promise<{ id: string }> {
  const { actor, now } = params
  const input = createAuctionSchema.parse(params.input)
  unwrap(authorizeAdminAction(actor, actor.guildId))

  return db.transaction(async (tx) => {
    const [auction] = await tx
      .insert(auctions)
      .values({
        guildId: actor.guildId,
        itemName: input.itemName,
        description: input.description ?? null,
        itemType: input.itemType,
        rarity: input.rarity,
        itemLevel: input.itemLevel,
        startingBid: input.startingBid,
        minIncrement: input.minIncrement,
        status: 'OPEN',
        endsAt: new Date(now.getTime() + input.durationMinutes * 60_000),
        createdByUserId: actor.id,
      })
      .returning({ id: auctions.id })

    if (!auction) throw new AppError('INTERNAL_ERROR', 'Failed to create the auction', 500)

    await recordAudit(
      {
        guildId: actor.guildId,
        actorUserId: actor.id,
        action: 'auction.create',
        entityType: 'auction',
        entityId: auction.id,
        after: { itemName: input.itemName, startingBid: input.startingBid },
      },
      tx,
    )

    return { id: auction.id }
  })
}

async function loadOwnCharacter(
  characterId: string,
  actor: Actor,
  executor: Executor,
): Promise<CharacterLike> {
  const [character] = await executor
    .select({
      id: characters.id,
      userId: characters.userId,
      guildId: characters.guildId,
      kind: characters.kind,
      mainCharacterId: characters.mainCharacterId,
      level: characters.level,
      isActive: characters.isActive,
    })
    .from(characters)
    .where(eq(characters.id, characterId))
    .limit(1)

  if (!character || character.userId !== actor.id) {
    throw new AppError('FORBIDDEN', 'You are not allowed to access this resource', 403)
  }
  return character
}

export async function placeBid(params: {
  actor: Actor
  auctionId: string
  characterId: string
  amount: number
  settings: SettingsLike
  now: Date
}): Promise<{ amount: number; endsAt: Date }> {
  const { actor, auctionId, characterId, amount, settings, now } = params

  return db.transaction(async (tx) => {
    // Serialize bidders on this auction: without the row lock, two concurrent
    // bids could both read the same current price and both "win".
    const [auction] = await tx
      .select()
      .from(auctions)
      .where(eq(auctions.id, auctionId))
      .limit(1)
      .for('update')
    if (!auction) throw new AppError('NOT_FOUND', 'Auction not found', 404)

    const character = await loadOwnCharacter(characterId, actor, tx)
    const restrictions = await loadRestrictions(actor.id, tx)
    const balance = await getBalance(actor.id, tx)

    unwrap(
      evaluateBid({
        auction,
        actor,
        character,
        restrictions,
        availablePoints: balance.available,
        amount,
        now,
      }),
    )

    // Refund the previous leader before locking the new bid.
    if (auction.currentBidderUserId && auction.currentBid !== null) {
      await appendLedger(
        {
          guildId: auction.guildId,
          userId: auction.currentBidderUserId,
          characterId: auction.currentBidderCharacterId,
          kind: 'AUCTION_RELEASE',
          state: 'CONFIRMED',
          amount: auction.currentBid,
          reason: `Outbid on "${auction.itemName}"`,
          refType: 'auction',
          refId: auction.id,
        },
        tx,
      )
      await tx
        .update(auctionBids)
        .set({ isWinning: false })
        .where(and(eq(auctionBids.auctionId, auction.id), eq(auctionBids.isWinning, true)))
    }

    const holdLedgerId = await appendLedger(
      {
        guildId: auction.guildId,
        userId: actor.id,
        characterId: character.id,
        kind: 'AUCTION_HOLD',
        state: 'CONFIRMED',
        amount: -amount,
        reason: `Bid on "${auction.itemName}"`,
        refType: 'auction',
        refId: auction.id,
      },
      tx,
    )

    await tx.insert(auctionBids).values({
      auctionId: auction.id,
      userId: actor.id,
      characterId: character.id,
      amount,
      holdLedgerId,
      isWinning: true,
      createdAt: now,
    })

    const endsAt = applyAntiSnipe(auction.endsAt, now, settings.auctionAntiSnipeSeconds)

    await tx
      .update(auctions)
      .set({
        currentBid: amount,
        currentBidderUserId: actor.id,
        currentBidderCharacterId: character.id,
        endsAt,
        updatedAt: now,
      })
      .where(eq(auctions.id, auction.id))

    await recordAudit(
      {
        guildId: auction.guildId,
        actorUserId: actor.id,
        action: 'auction.bid',
        entityType: 'auction',
        entityId: auction.id,
        after: { amount, characterId: character.id },
      },
      tx,
    )

    return { amount, endsAt }
  })
}

/**
 * Closes auctions whose clock ran out. The winner's hold stays as the spend;
 * an auction with no bids simply closes.
 */
export async function settleAuctions(now: Date): Promise<{ settled: string[] }> {
  const due = await db
    .select({ id: auctions.id })
    .from(auctions)
    .where(and(eq(auctions.status, 'OPEN'), lte(auctions.endsAt, now)))
    .limit(200)

  const settled: string[] = []

  for (const { id } of due) {
    await db.transaction(async (tx) => {
      const [auction] = await tx
        .select()
        .from(auctions)
        .where(eq(auctions.id, id))
        .limit(1)
        .for('update')
      // A late bid may have extended the clock between the scan and now.
      if (!auction || auction.status !== 'OPEN' || auction.endsAt.getTime() > now.getTime()) return

      await tx
        .update(auctions)
        .set({
          status: auction.currentBidderUserId ? 'SETTLED' : 'CLOSED',
          settledAt: now,
          updatedAt: now,
        })
        .where(eq(auctions.id, auction.id))

      await recordAudit(
        {
          guildId: auction.guildId,
          actorUserId: null,
          action: 'auction.settle',
          entityType: 'auction',
          entityId: auction.id,
          after: { winnerUserId: auction.currentBidderUserId, amount: auction.currentBid },
        },
        tx,
      )

      settled.push(auction.id)
    })
  }

  return { settled }
}

/**
 * Cancels an auction and releases every outstanding hold, so a withdrawn item
 * never leaves points stranded.
 */
export async function cancelAuction(params: {
  actor: Actor
  auctionId: string
  reason: string
  now: Date
}): Promise<void> {
  const { actor, auctionId, reason, now } = params
  if (reason.trim().length < 3) throw new AppError('REASON_REQUIRED', 'A reason is required')

  await db.transaction(async (tx) => {
    const [auction] = await tx
      .select()
      .from(auctions)
      .where(eq(auctions.id, auctionId))
      .limit(1)
      .for('update')
    if (!auction) throw new AppError('NOT_FOUND', 'Auction not found', 404)
    unwrap(authorizeAdminAction(actor, auction.guildId))
    if (auction.status === 'CANCELLED' || auction.status === 'SETTLED') return

    if (auction.currentBidderUserId && auction.currentBid !== null) {
      await appendLedger(
        {
          guildId: auction.guildId,
          userId: auction.currentBidderUserId,
          characterId: auction.currentBidderCharacterId,
          kind: 'AUCTION_RELEASE',
          state: 'CONFIRMED',
          amount: auction.currentBid,
          reason: `Auction "${auction.itemName}" cancelled`,
          refType: 'auction',
          refId: auction.id,
          createdByUserId: actor.id,
        },
        tx,
      )
    }

    await tx
      .update(auctions)
      .set({ status: 'CANCELLED', updatedAt: now })
      .where(eq(auctions.id, auction.id))
    await tx
      .update(auctionBids)
      .set({ isWinning: false })
      .where(eq(auctionBids.auctionId, auction.id))

    await recordAudit(
      {
        guildId: auction.guildId,
        actorUserId: actor.id,
        action: 'auction.cancel',
        entityType: 'auction',
        entityId: auction.id,
        after: { reason },
      },
      tx,
    )
  })
}

export async function listAuctions(guildId: string, limit = 100) {
  const rows = await db
    .select()
    .from(auctions)
    .where(and(eq(auctions.guildId, guildId), inArray(auctions.status, ['OPEN', 'SETTLED', 'CLOSED'])))
    .orderBy(desc(auctions.createdAt))
    .limit(limit)

  return rows.map((auction) => ({ ...auction, nextMinimumBid: minimumBid(auction) }))
}

/** A member's own bidding history, including the holds still locking points. */
export async function listOwnBids(userId: string, limit = 50) {
  return db
    .select({
      auctionId: auctionBids.auctionId,
      itemName: auctions.itemName,
      amount: auctionBids.amount,
      isWinning: auctionBids.isWinning,
      auctionStatus: auctions.status,
      endsAt: auctions.endsAt,
      createdAt: auctionBids.createdAt,
      holdState: pointLedger.state,
    })
    .from(auctionBids)
    .innerJoin(auctions, eq(auctions.id, auctionBids.auctionId))
    .leftJoin(pointLedger, eq(pointLedger.id, auctionBids.holdLedgerId))
    .where(eq(auctionBids.userId, userId))
    .orderBy(desc(auctionBids.createdAt))
    .limit(limit)
}
