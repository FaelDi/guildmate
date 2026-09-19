'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { AppError, runAction, type ActionResult } from '@/lib/errors'
import { rateLimit } from '@/lib/rate-limit'
import { getSettings, requireAdmin, requireSession } from '@/lib/session'
import { deleteBoss, deleteBossGroup, saveBoss, saveBossGroup, setRotation } from '@/services/bosses'
import {
  closeBanner,
  createBanner,
  createBannerSchema,
  drawItem,
  extendBanner,
  placeBet,
  updateLootNote,
  withdrawBet,
  type DrawResult,
} from '@/services/loot'
import { deleteMemeDraw, drawMeme, updateMemeNote } from '@/services/meme'
import { applyPenalty, reversePenalty } from '@/services/penalties'
import { advanceWeek, excuseAbsence, revokeExcuse, updateThresholds } from '@/services/weeks'

/**
 * Entry points for the command-center screens: the ranking, the loot wheel,
 * the meme raffle and the boss schedule.
 *
 * Every input arrives as a plain object from a client component and is
 * therefore attacker-controlled: it is shape-checked here, and every id is
 * re-authorized by the service against the row it loads. Nothing below trusts
 * a user id, character id or amount it was handed.
 */

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success) throw new AppError('INVALID_INPUT', 'Check the values and try again')
  return parsed.data
}

/** Every screen reads from the same board, so a write refreshes them all. */
function refresh(): void {
  revalidatePath('/', 'layout')
}

const id = z.string().max(64)
const reason = z.string().max(300)

// ---------------------------------------------------------------------------
// Week, thresholds, attendance, penalties (admin)
// ---------------------------------------------------------------------------

export async function advanceWeekAction(): Promise<ActionResult<{ number: number }>> {
  const result = await runAction(async () => {
    const { actor, now } = await requireAdmin()
    return advanceWeek({ actor, now })
  })
  if (result.ok) refresh()
  return result
}

export async function updateThresholdsAction(input: unknown): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    const { actor } = await requireAdmin()
    const data = parse(z.object({ megaCpThreshold: z.number(), titanCpThreshold: z.number() }), input)
    await updateThresholds({ actor, ...data })
    return null
  })
  if (result.ok) refresh()
  return result
}

export async function excuseAbsenceAction(input: unknown): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    const { actor, now } = await requireAdmin()
    const data = parse(z.object({ userId: id, eventsExcused: z.number(), reason }), input)
    await excuseAbsence({ actor, ...data, now })
    return null
  })
  if (result.ok) refresh()
  return result
}

export async function revokeExcuseAction(input: unknown): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    const { actor, now } = await requireAdmin()
    const data = parse(z.object({ excuseId: id }), input)
    await revokeExcuse({ actor, excuseId: data.excuseId, now })
    return null
  })
  if (result.ok) refresh()
  return result
}

export async function applyPenaltyAction(input: unknown): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    const { actor } = await requireAdmin()
    const data = parse(z.object({ userId: id, points: z.number(), reason }), input)
    await applyPenalty({ actor, ...data })
    return null
  })
  if (result.ok) refresh()
  return result
}

export async function reversePenaltyAction(input: unknown): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    const { actor } = await requireAdmin()
    const data = parse(z.object({ penaltyId: id }), input)
    await reversePenalty({ actor, penaltyId: data.penaltyId })
    return null
  })
  if (result.ok) refresh()
  return result
}

// ---------------------------------------------------------------------------
// Loot
// ---------------------------------------------------------------------------

export async function createBannerAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const result = await runAction(async () => {
    const { actor, now } = await requireAdmin()
    return createBanner({ actor, input: parse(createBannerSchema, input), now })
  })
  if (result.ok) refresh()
  return result
}

export async function extendBannerAction(input: unknown): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    const { actor, now } = await requireAdmin()
    const data = parse(z.object({ bannerId: id, hours: z.number() }), input)
    await extendBanner({ actor, ...data, now })
    return null
  })
  if (result.ok) refresh()
  return result
}

export async function closeBannerAction(input: unknown): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    const { actor, now } = await requireAdmin()
    const data = parse(z.object({ bannerId: id }), input)
    await closeBanner({ actor, bannerId: data.bannerId, now })
    return null
  })
  if (result.ok) refresh()
  return result
}

export async function placeBetAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const result = await runAction(async () => {
    const { actor, restrictions, now } = await requireSession()

    const limit = rateLimit({ key: `bet:${actor.id}`, limit: 20, windowMs: 60_000 })
    if (!limit.allowed) throw new AppError('RATE_LIMITED', 'Too many attempts. Wait a minute.', 429)

    const data = parse(z.object({ itemId: id, points: z.number() }), input)
    return placeBet({
      actor,
      restrictions,
      settings: await getSettings(actor.guildId),
      itemId: data.itemId,
      points: data.points,
      now,
    })
  })
  if (result.ok) refresh()
  return result
}

export async function withdrawBetAction(input: unknown): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    const { actor, now } = await requireSession()
    const data = parse(z.object({ betId: id }), input)
    await withdrawBet({ actor, betId: data.betId, now })
    return null
  })
  if (result.ok) refresh()
  return result
}

export async function drawItemAction(input: unknown): Promise<ActionResult<DrawResult>> {
  const result = await runAction(async () => {
    const { actor, now } = await requireAdmin()
    const data = parse(z.object({ itemId: id, staffUserId: id.nullable() }), input)
    return drawItem({
      actor,
      settings: await getSettings(actor.guildId),
      itemId: data.itemId,
      staffUserId: data.staffUserId,
      now,
    })
  })
  if (result.ok) refresh()
  return result
}

export async function updateLootNoteAction(input: unknown): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    const { actor } = await requireAdmin()
    const data = parse(z.object({ itemId: id, note: z.string().max(300) }), input)
    await updateLootNote({ actor, ...data })
    return null
  })
  if (result.ok) refresh()
  return result
}

// ---------------------------------------------------------------------------
// Meme raffle
// ---------------------------------------------------------------------------

export async function drawMemeAction(
  input: unknown,
): Promise<ActionResult<{ winnerName: string; candidates: string[] }>> {
  const result = await runAction(async () => {
    const { actor } = await requireAdmin()
    const data = parse(
      z.object({ itemName: z.string().max(200), characterIds: z.array(id).max(500) }),
      input,
    )
    return drawMeme({ actor, ...data })
  })
  if (result.ok) refresh()
  return result
}

export async function updateMemeNoteAction(input: unknown): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    const { actor } = await requireAdmin()
    const data = parse(z.object({ id, note: z.string().max(300) }), input)
    await updateMemeNote({ actor, ...data })
    return null
  })
  if (result.ok) refresh()
  return result
}

export async function deleteMemeDrawAction(input: unknown): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    const { actor } = await requireAdmin()
    const data = parse(z.object({ id }), input)
    await deleteMemeDraw({ actor, id: data.id })
    return null
  })
  if (result.ok) refresh()
  return result
}

// ---------------------------------------------------------------------------
// Bosses
// ---------------------------------------------------------------------------

const scheduleInput = z.object({
  respawnKind: z.enum(['INTERVAL', 'DAILY', 'WEEKLY']),
  intervalHours: z.number().int().nullable(),
  /** Epoch ms from the client's datetime picker. */
  anchorAtMs: z.number().nullable(),
  dailyTimes: z.string().max(200).nullable(),
  weekdays: z.string().max(20).nullable(),
})

function toSchedule(input: z.infer<typeof scheduleInput>) {
  return {
    respawnKind: input.respawnKind,
    intervalHours: input.intervalHours,
    anchorAt: input.anchorAtMs === null ? null : new Date(input.anchorAtMs),
    dailyTimes: input.dailyTimes,
    weekdays: input.weekdays,
  }
}

export async function saveBossGroupAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const result = await runAction(async () => {
    const { actor } = await requireAdmin()
    const data = parse(
      z.object({ id: id.nullable(), name: z.string().max(200), schedule: scheduleInput }),
      input,
    )
    return saveBossGroup({ actor, id: data.id, name: data.name, schedule: toSchedule(data.schedule) })
  })
  if (result.ok) refresh()
  return result
}

export async function deleteBossGroupAction(input: unknown): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    const { actor } = await requireAdmin()
    await deleteBossGroup({ actor, id: parse(z.object({ id }), input).id })
    return null
  })
  if (result.ok) refresh()
  return result
}

export async function saveBossAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const result = await runAction(async () => {
    const { actor } = await requireAdmin()
    const data = parse(
      z.object({
        id: id.nullable(),
        name: z.string().max(200),
        location: z.string().max(200),
        groupId: id.nullable(),
        schedule: scheduleInput.nullable(),
      }),
      input,
    )
    return saveBoss({
      actor,
      id: data.id,
      name: data.name,
      location: data.location,
      groupId: data.groupId,
      schedule: data.schedule ? toSchedule(data.schedule) : null,
    })
  })
  if (result.ok) refresh()
  return result
}

export async function deleteBossAction(input: unknown): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    const { actor } = await requireAdmin()
    await deleteBoss({ actor, id: parse(z.object({ id }), input).id })
    return null
  })
  if (result.ok) refresh()
  return result
}

export async function setRotationAction(input: unknown): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    const { actor } = await requireAdmin()
    const data = parse(z.object({ bossIds: z.array(id).max(500) }), input)
    await setRotation({ actor, bossIds: data.bossIds })
    return null
  })
  if (result.ok) refresh()
  return result
}
