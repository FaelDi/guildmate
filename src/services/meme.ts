import 'server-only'

import { webcrypto } from 'node:crypto'
import { desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import { characters, memeDraws } from '@/db/schema'
import { recordAudit } from '@/lib/audit'
import { AppError, unwrap } from '@/lib/errors'
import {
  authorizeAdminAction,
  evaluateMemeDraw,
  MEME_MAX_CANDIDATES,
  pickUniformIndex,
  type Actor,
} from '@/lib/rules'

/**
 * The meme raffle: an admin picks members, the server picks one of them. No
 * points move, so the only thing to guard is that the candidates are real
 * members of this guild and the pick is not the client's.
 */

const idsSchema = z.array(z.string().uuid()).max(MEME_MAX_CANDIDATES)

function secureRoll(): number {
  const buffer = new Uint32Array(1)
  webcrypto.getRandomValues(buffer)
  return (buffer[0] ?? 0) / 2 ** 32
}

export async function drawMeme(params: {
  actor: Actor
  itemName: string
  characterIds: string[]
}): Promise<{ winnerName: string; candidates: string[] }> {
  const { actor } = params
  const parsed = idsSchema.safeParse([...new Set(params.characterIds)])
  if (!parsed.success) {
    throw new AppError('INVALID_CANDIDATES', 'Every candidate must be an active member of this guild')
  }
  const ids = parsed.data

  return db.transaction(async (tx) => {
    const candidates =
      ids.length === 0
        ? []
        : await tx
            .select({
              id: characters.id,
              guildId: characters.guildId,
              isActive: characters.isActive,
              name: characters.name,
            })
            .from(characters)
            .where(inArray(characters.id, ids))
            .limit(MEME_MAX_CANDIDATES)

    const plan = unwrap(
      evaluateMemeDraw({
        actor,
        guildId: actor.guildId,
        itemName: params.itemName,
        candidates,
        requestedCount: ids.length,
      }),
    )

    const winner = candidates[pickUniformIndex(candidates.length, secureRoll())]
    if (!winner) throw new AppError('INVALID_CANDIDATES', 'Pick at least one member')

    const [row] = await tx
      .insert(memeDraws)
      .values({
        guildId: actor.guildId,
        itemName: plan.itemName,
        winnerCharacterId: winner.id,
        winnerName: winner.name,
        candidateCount: candidates.length,
        drawnByUserId: actor.id,
      })
      .returning({ id: memeDraws.id })

    await recordAudit(
      {
        guildId: actor.guildId,
        actorUserId: actor.id,
        action: 'meme.draw',
        entityType: 'meme_draw',
        entityId: row?.id ?? null,
        after: { itemName: plan.itemName, winner: winner.name, candidates: candidates.length },
      },
      tx,
    )

    return { winnerName: winner.name, candidates: candidates.map((c) => c.name) }
  })
}

async function loadOwnGuildDraw(actor: Actor, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new AppError('NOT_FOUND', 'Not found', 404)
  const [draw] = await db.select().from(memeDraws).where(eq(memeDraws.id, id)).limit(1)
  if (!draw || draw.guildId !== actor.guildId) throw new AppError('NOT_FOUND', 'Not found', 404)
  unwrap(authorizeAdminAction(actor, draw.guildId))
  return draw
}

export async function updateMemeNote(params: { actor: Actor; id: string; note: string }) {
  const draw = await loadOwnGuildDraw(params.actor, params.id)
  const note = params.note.trim().slice(0, 200)

  await db.transaction(async (tx) => {
    await tx
      .update(memeDraws)
      .set({ note: note.length > 0 ? note : null })
      .where(eq(memeDraws.id, draw.id))
    await recordAudit(
      {
        guildId: draw.guildId,
        actorUserId: params.actor.id,
        action: 'meme.note',
        entityType: 'meme_draw',
        entityId: draw.id,
        before: { note: draw.note },
        after: { note },
      },
      tx,
    )
  })
}

/** Meme history carries no points, so a mistaken row may simply go. */
export async function deleteMemeDraw(params: { actor: Actor; id: string }) {
  const draw = await loadOwnGuildDraw(params.actor, params.id)

  await db.transaction(async (tx) => {
    await tx.delete(memeDraws).where(eq(memeDraws.id, draw.id))
    await recordAudit(
      {
        guildId: draw.guildId,
        actorUserId: params.actor.id,
        action: 'meme.delete',
        entityType: 'meme_draw',
        entityId: draw.id,
        before: { itemName: draw.itemName, winner: draw.winnerName },
      },
      tx,
    )
  })
}

export async function listMemeDraws(guildId: string, limit = 200) {
  return db
    .select()
    .from(memeDraws)
    .where(eq(memeDraws.guildId, guildId))
    .orderBy(desc(memeDraws.createdAt))
    .limit(limit)
}
