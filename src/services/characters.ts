import 'server-only'

import { and, asc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db, type Transaction } from '@/db'
import { characters } from '@/db/schema'
import { recordAudit } from '@/lib/audit'
import { AppError, unwrap } from '@/lib/errors'
import {
  authorizeResource,
  evaluateCharacterCreate,
  evaluateCharacterRetire,
  evaluateCharacterUpdate,
  evaluateMainSwitch,
  type Actor,
  type CharacterLike,
  type RestrictionLike,
} from '@/lib/rules'

/**
 * The member's own roster.
 *
 * Everything here is self-service and deliberately gives admins no override
 * (`allowAdminOverride: false`): which character is the MAIN decides where an
 * ALT's points are attributed, so an admin able to reshape someone else's
 * roster could redirect attribution without ever touching the ledger.
 * Moderation acts on the account, not on the roster.
 */

/**
 * Shape only. The bounds live in `validateCharacterFields` inside the rules, so
 * a member who types a 41-character name gets that rule's message instead of
 * the generic "something went wrong" a ZodError would produce - and the bound
 * is written down in exactly one place.
 */
export const characterDraftSchema = z.object({
  name: z.string(),
  race: z.enum(['BELLATO', 'CORA', 'ACCRETIA']),
  biosuit: z.string(),
  level: z.number(),
  kind: z.enum(['MAIN', 'ALT']),
})

export const characterPatchSchema = characterDraftSchema.pick({
  name: true,
  biosuit: true,
  level: true,
})

export type CharacterDraftDto = z.infer<typeof characterDraftSchema>
export type CharacterPatchDto = z.infer<typeof characterPatchSchema>

const ROSTER_COLUMNS = {
  id: characters.id,
  userId: characters.userId,
  guildId: characters.guildId,
  kind: characters.kind,
  mainCharacterId: characters.mainCharacterId,
  level: characters.level,
  isActive: characters.isActive,
}

/**
 * A character id arriving in a FormData is attacker-controlled and goes
 * straight into a uuid column. Anything that is not a uuid is refused with the
 * same denial as somebody else's character, rather than reaching Postgres and
 * coming back as a generic failure.
 */
function assertCharacterId(value: string): string {
  if (!z.string().uuid().safeParse(value).success) {
    throw new AppError('FORBIDDEN', 'You are not allowed to access this resource', 403)
  }
  return value
}

/**
 * Loads and locks the whole roster of one account, retired characters
 * included: a retired MAIN still holds the one-main-per-account slot, and the
 * lock is what serialises two tabs racing to promote different characters.
 *
 * The rules need the complete roster to decide, so this must never truncate
 * one. It cannot: `MAX_CHARACTERS_PER_ACCOUNT` counts every row, retired ones
 * included, and the limit here is an order of magnitude above it. The `id`
 * ordering makes two concurrent transactions take the row locks in the same
 * order, so they queue instead of deadlocking.
 */
async function loadRosterForUpdate(userId: string, tx: Transaction): Promise<CharacterLike[]> {
  return tx
    .select(ROSTER_COLUMNS)
    .from(characters)
    .where(eq(characters.userId, userId))
    .orderBy(asc(characters.id))
    .limit(100)
    .for('update')
}

/**
 * Two unique indexes protect this table, and both can only be decided by the
 * database: the guild-wide name and the single MAIN per account. A concurrent
 * writer that wins the race surfaces here.
 */
function translateWriteError(error: unknown): never {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code, constraint_name: constraint } = error as {
      code?: unknown
      constraint_name?: unknown
    }
    if (code === '23505') {
      if (constraint === 'characters_one_main_per_user') {
        throw new AppError('MAIN_ALREADY_EXISTS', 'This account already has a main character', 409)
      }
      throw new AppError('NAME_TAKEN', 'That character name is already taken in this guild', 409)
    }
  }
  throw error
}

export async function createCharacter(params: {
  actor: Actor
  restrictions: readonly RestrictionLike[]
  input: CharacterDraftDto
  now: Date
}): Promise<{ id: string }> {
  const { actor, restrictions, now } = params
  const input = characterDraftSchema.parse(params.input)

  try {
    return await db.transaction(async (tx) => {
      const roster = await loadRosterForUpdate(actor.id, tx)
      const plan = unwrap(evaluateCharacterCreate({ actor, restrictions, roster, input, now }))

      const [created] = await tx
        .insert(characters)
        .values({
          userId: actor.id,
          guildId: actor.guildId,
          name: plan.character.name,
          nameNormalized: plan.character.name.toLowerCase(),
          race: plan.character.race,
          biosuit: plan.character.biosuit,
          level: plan.character.level,
          kind: plan.character.kind,
          mainCharacterId: plan.mainCharacterId,
        })
        .returning({ id: characters.id })

      if (!created) throw new AppError('INTERNAL_ERROR', 'Failed to create the character', 500)

      // An ALT that predates the MAIN was left unlinked at sign-up. The MAIN
      // adopts it now, so its points roll up from here on.
      if (plan.adoptAltIds.length > 0) {
        await tx
          .update(characters)
          .set({ mainCharacterId: created.id, updatedAt: now })
          .where(
            and(eq(characters.userId, actor.id), inArray(characters.id, plan.adoptAltIds)),
          )
      }

      await recordAudit(
        {
          guildId: actor.guildId,
          actorUserId: actor.id,
          action: 'character.create',
          entityType: 'character',
          entityId: created.id,
          after: {
            name: plan.character.name,
            kind: plan.character.kind,
            level: plan.character.level,
            mainCharacterId: plan.mainCharacterId,
            adoptedAlts: plan.adoptAltIds.length,
          },
        },
        tx,
      )

      return { id: created.id }
    })
  } catch (error) {
    if (error instanceof AppError) throw error
    translateWriteError(error)
  }
}

export async function updateCharacter(params: {
  actor: Actor
  restrictions: readonly RestrictionLike[]
  characterId: string
  patch: CharacterPatchDto
  now: Date
}): Promise<void> {
  const { actor, restrictions, now } = params
  const characterId = assertCharacterId(params.characterId)
  const patch = characterPatchSchema.parse(params.patch)

  try {
    await db.transaction(async (tx) => {
      const [character] = await tx
        .select()
        .from(characters)
        .where(eq(characters.id, characterId))
        .limit(1)
        .for('update')
      // Same denial a stranger's character gets: never confirm that a
      // character id is real.
      if (!character) {
        throw new AppError('FORBIDDEN', 'You are not allowed to access this resource', 403)
      }

      unwrap(
        authorizeResource({
          actor,
          ownerUserId: character.userId,
          resourceGuildId: character.guildId,
          allowAdminOverride: false,
        }),
      )

      const validated = unwrap(
        evaluateCharacterUpdate({ actor, restrictions, character, input: patch, now }),
      )

      await tx
        .update(characters)
        .set({
          name: validated.name,
          nameNormalized: validated.name.toLowerCase(),
          biosuit: validated.biosuit,
          level: validated.level,
          updatedAt: now,
        })
        .where(eq(characters.id, characterId))

      await recordAudit(
        {
          guildId: character.guildId,
          actorUserId: actor.id,
          action: 'character.update',
          entityType: 'character',
          entityId: characterId,
          before: {
            name: character.name,
            biosuit: character.biosuit,
            level: character.level,
          },
          after: validated,
        },
        tx,
      )
    })
  } catch (error) {
    if (error instanceof AppError) throw error
    translateWriteError(error)
  }
}

/**
 * Promotes a character to MAIN and rebuilds the links around it in one
 * transaction: the old MAIN is demoted first, because the partial unique index
 * refuses a second MAIN even mid-transaction.
 */
export async function setMainCharacter(params: {
  actor: Actor
  restrictions: readonly RestrictionLike[]
  characterId: string
  now: Date
}): Promise<void> {
  const { actor, restrictions, characterId, now } = params

  try {
    await db.transaction(async (tx) => {
      const roster = await loadRosterForUpdate(actor.id, tx)
      const plan = unwrap(
        evaluateMainSwitch({ actor, restrictions, roster, targetCharacterId: characterId, now }),
      )

      if (plan.demoteMainId) {
        await tx
          .update(characters)
          .set({ kind: 'ALT', mainCharacterId: plan.newMainId, updatedAt: now })
          .where(and(eq(characters.id, plan.demoteMainId), eq(characters.userId, actor.id)))
      }

      await tx
        .update(characters)
        .set({ kind: 'MAIN', mainCharacterId: null, updatedAt: now })
        .where(and(eq(characters.id, plan.newMainId), eq(characters.userId, actor.id)))

      if (plan.relinkAltIds.length > 0) {
        await tx
          .update(characters)
          .set({ mainCharacterId: plan.newMainId, updatedAt: now })
          .where(
            and(eq(characters.userId, actor.id), inArray(characters.id, plan.relinkAltIds)),
          )
      }

      await recordAudit(
        {
          guildId: actor.guildId,
          actorUserId: actor.id,
          action: 'character.main_switch',
          entityType: 'character',
          entityId: plan.newMainId,
          before: { mainCharacterId: plan.demoteMainId },
          after: { mainCharacterId: plan.newMainId, relinked: plan.relinkAltIds.length },
        },
        tx,
      )
    })
  } catch (error) {
    if (error instanceof AppError) throw error
    translateWriteError(error)
  }
}

/** Logical retirement. The row survives, so the ledger and history stay intact. */
export async function retireCharacter(params: {
  actor: Actor
  restrictions: readonly RestrictionLike[]
  characterId: string
  now: Date
}): Promise<void> {
  const { actor, restrictions, characterId, now } = params

  await db.transaction(async (tx) => {
    const roster = await loadRosterForUpdate(actor.id, tx)
    const target = unwrap(
      evaluateCharacterRetire({ actor, restrictions, roster, targetCharacterId: characterId, now }),
    )

    await tx
      .update(characters)
      .set({ isActive: false, updatedAt: now })
      .where(and(eq(characters.id, target.characterId), eq(characters.userId, actor.id)))

    await recordAudit(
      {
        guildId: actor.guildId,
        actorUserId: actor.id,
        action: 'character.retire',
        entityType: 'character',
        entityId: target.characterId,
        after: { isActive: false },
      },
      tx,
    )
  })
}

/** The full roster for the profile screen, retired characters included. */
export async function listRoster(userId: string, limit = 100) {
  return db
    .select()
    .from(characters)
    .where(eq(characters.userId, userId))
    .orderBy(asc(characters.kind), asc(characters.name))
    .limit(limit)
}
