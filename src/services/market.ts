import 'server-only'

import { and, desc, eq, inArray, lte, ne } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import { characters, marketListings, users } from '@/db/schema'
import { recordAudit } from '@/lib/audit'
import { AppError, unwrap } from '@/lib/errors'
import {
  authorizeResource,
  evaluateListingCreate,
  evaluateMarketAccess,
  type Actor,
  type CharacterLike,
  type RestrictionLike,
} from '@/lib/rules'

/**
 * The guild store: members advertise their own items, priced in DIAMONDS.
 *
 * Diamonds are the in-game currency and are deliberately NOT tracked as a
 * balance here - the portal is a classifieds board, and the trade itself
 * happens in game. Keeping diamonds out of the ledger is what stops the store
 * from becoming a second, unauditable economy alongside event points.
 */

export const listingInputSchema = z.object({
  itemName: z.string().trim().min(2).max(120),
  itemType: z.enum([
    'WEAPON',
    'ARMOR',
    'SHIELD',
    'HELMET',
    'GLOVES',
    'BOOTS',
    'ACCESSORY',
    'BIOSUIT',
    'MATERIAL',
    'CONSUMABLE',
    'OTHER',
  ]),
  rarity: z.enum(['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY']),
  itemLevel: z.number().int().min(1).max(999),
  priceDiamonds: z.number().int().min(1).max(1_000_000_000),
  quantity: z.number().int().min(1).max(9999),
  notes: z.string().trim().max(500).optional(),
})

export type ListingInputDto = z.infer<typeof listingInputSchema>

async function loadOwnCharacter(characterId: string, actor: Actor): Promise<CharacterLike> {
  const [character] = await db
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

export async function createListing(params: {
  actor: Actor
  restrictions: readonly RestrictionLike[]
  characterId: string
  input: ListingInputDto
  now: Date
}): Promise<{ id: string }> {
  const { actor, restrictions, characterId, now } = params
  const input = listingInputSchema.parse(params.input)
  const character = await loadOwnCharacter(characterId, actor)

  const validated = unwrap(
    evaluateListingCreate({
      actor,
      character,
      restrictions,
      input: {
        itemName: input.itemName,
        itemType: input.itemType,
        rarity: input.rarity,
        itemLevel: input.itemLevel,
        priceDiamonds: input.priceDiamonds,
        quantity: input.quantity,
      },
      now,
    }),
  )

  return db.transaction(async (tx) => {
    const [listing] = await tx
      .insert(marketListings)
      .values({
        guildId: actor.guildId,
        sellerUserId: actor.id,
        sellerCharacterId: character.id,
        itemName: validated.itemName,
        itemType: validated.itemType,
        rarity: validated.rarity,
        itemLevel: validated.itemLevel,
        priceDiamonds: validated.priceDiamonds,
        quantity: validated.quantity,
        notes: input.notes?.trim() || null,
        status: 'ACTIVE',
        // Listings go stale fast in a live game; 30 days keeps the board honest.
        expiresAt: new Date(now.getTime() + 30 * 24 * 3_600_000),
      })
      .returning({ id: marketListings.id })

    if (!listing) throw new AppError('INTERNAL_ERROR', 'Failed to create the listing', 500)

    await recordAudit(
      {
        guildId: actor.guildId,
        actorUserId: actor.id,
        action: 'market.create',
        entityType: 'market_listing',
        entityId: listing.id,
        after: { itemName: validated.itemName, priceDiamonds: validated.priceDiamonds },
      },
      tx,
    )

    return { id: listing.id }
  })
}

/**
 * Edits a listing. The ownership check is the point: a member may only change
 * what they created. Admins can also act, for moderation.
 */
export async function updateListing(params: {
  actor: Actor
  restrictions: readonly RestrictionLike[]
  listingId: string
  patch: Partial<ListingInputDto>
  now: Date
}): Promise<void> {
  const { actor, restrictions, listingId, patch, now } = params
  // A member barred from the store may not rewrite what they already posted.
  unwrap(evaluateMarketAccess({ actor, restrictions, now }))

  await db.transaction(async (tx) => {
    const [listing] = await tx
      .select()
      .from(marketListings)
      .where(eq(marketListings.id, listingId))
      .limit(1)
    if (!listing) throw new AppError('NOT_FOUND', 'Listing not found', 404)

    unwrap(
      authorizeResource({
        actor,
        ownerUserId: listing.sellerUserId,
        resourceGuildId: listing.guildId,
      }),
    )

    if (listing.status !== 'ACTIVE') {
      throw new AppError('LISTING_CLOSED', 'Only an active listing can be edited')
    }

    const validated = listingInputSchema.partial().parse(patch)

    await tx
      .update(marketListings)
      .set({
        itemName: validated.itemName ?? listing.itemName,
        itemType: validated.itemType ?? listing.itemType,
        rarity: validated.rarity ?? listing.rarity,
        itemLevel: validated.itemLevel ?? listing.itemLevel,
        priceDiamonds: validated.priceDiamonds ?? listing.priceDiamonds,
        quantity: validated.quantity ?? listing.quantity,
        notes: validated.notes ?? listing.notes,
        updatedAt: now,
      })
      .where(eq(marketListings.id, listingId))

    await recordAudit(
      {
        guildId: listing.guildId,
        actorUserId: actor.id,
        action: 'market.update',
        entityType: 'market_listing',
        entityId: listingId,
        before: { priceDiamonds: listing.priceDiamonds, itemName: listing.itemName },
        after: validated,
      },
      tx,
    )
  })
}

export async function closeListing(params: {
  actor: Actor
  restrictions: readonly RestrictionLike[]
  listingId: string
  status: 'SOLD' | 'CANCELLED'
  soldToCharacterId?: string | null
  now: Date
}): Promise<void> {
  const { actor, restrictions, listingId, status, soldToCharacterId, now } = params
  unwrap(evaluateMarketAccess({ actor, restrictions, now }))

  await db.transaction(async (tx) => {
    const [listing] = await tx
      .select()
      .from(marketListings)
      .where(eq(marketListings.id, listingId))
      .limit(1)
    if (!listing) throw new AppError('NOT_FOUND', 'Listing not found', 404)

    unwrap(
      authorizeResource({
        actor,
        ownerUserId: listing.sellerUserId,
        resourceGuildId: listing.guildId,
      }),
    )
    if (listing.status !== 'ACTIVE' && listing.status !== 'RESERVED') {
      throw new AppError('LISTING_CLOSED', 'This listing is already closed')
    }

    await tx
      .update(marketListings)
      .set({
        status,
        soldAt: status === 'SOLD' ? now : null,
        soldToCharacterId: status === 'SOLD' ? (soldToCharacterId ?? null) : null,
        updatedAt: now,
      })
      .where(eq(marketListings.id, listingId))

    await recordAudit(
      {
        guildId: listing.guildId,
        actorUserId: actor.id,
        action: status === 'SOLD' ? 'market.sold' : 'market.cancel',
        entityType: 'market_listing',
        entityId: listingId,
        after: { status },
      },
      tx,
    )
  })
}

export type MarketFilters = {
  rarity?: ListingInputDto['rarity']
  itemType?: ListingInputDto['itemType']
  maxPrice?: number
}

export async function listMarket(guildId: string, filters: MarketFilters = {}, limit = 100) {
  const conditions = [eq(marketListings.guildId, guildId), eq(marketListings.status, 'ACTIVE')]
  if (filters.rarity) conditions.push(eq(marketListings.rarity, filters.rarity))
  if (filters.itemType) conditions.push(eq(marketListings.itemType, filters.itemType))
  if (filters.maxPrice !== undefined) {
    conditions.push(lte(marketListings.priceDiamonds, filters.maxPrice))
  }

  return db
    .select({
      id: marketListings.id,
      itemName: marketListings.itemName,
      itemType: marketListings.itemType,
      rarity: marketListings.rarity,
      itemLevel: marketListings.itemLevel,
      priceDiamonds: marketListings.priceDiamonds,
      quantity: marketListings.quantity,
      notes: marketListings.notes,
      createdAt: marketListings.createdAt,
      sellerUserId: marketListings.sellerUserId,
      sellerCharacterName: characters.name,
      sellerEmail: users.email,
    })
    .from(marketListings)
    .innerJoin(characters, eq(characters.id, marketListings.sellerCharacterId))
    .innerJoin(users, eq(users.id, marketListings.sellerUserId))
    .where(and(...conditions))
    .orderBy(desc(marketListings.createdAt))
    .limit(limit)
}

/** Withdraws listings past their expiry. Called by the scheduled sweep. */
export async function expireListings(now: Date): Promise<number> {
  const expired = await db
    .update(marketListings)
    .set({ status: 'EXPIRED', updatedAt: now })
    .where(
      and(
        inArray(marketListings.status, ['ACTIVE', 'RESERVED']),
        ne(marketListings.status, 'EXPIRED'),
        lte(marketListings.expiresAt, now),
      ),
    )
    .returning({ id: marketListings.id })

  return expired.length
}
