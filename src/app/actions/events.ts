'use server'

import { revalidatePath } from 'next/cache'
import { runAction, type ActionResult } from '@/lib/errors'
import { rateLimit } from '@/lib/rate-limit'
import { AppError } from '@/lib/errors'
import { getRequestFingerprint, getSettings, requireAdmin, requireSession } from '@/lib/session'
import {
  cancelEvent,
  changeEventPoints,
  createEvent,
  grantEventPoints,
  registerWithCode,
  rotateEventCode,
  type RegistrationOutcome,
} from '@/services/events'

export async function redeemCodeAction(
  _previous: ActionResult<RegistrationOutcome> | null,
  formData: FormData,
): Promise<ActionResult<RegistrationOutcome>> {
  const result = await runAction(async () => {
    const { actor, now } = await requireSession()

    // Guessing a short code must not be cheap, even for a signed-in member.
    const limit = rateLimit({ key: `redeem:${actor.id}`, limit: 12, windowMs: 5 * 60_000 })
    if (!limit.allowed) {
      throw new AppError('RATE_LIMITED', 'Too many attempts. Wait a few minutes.', 429)
    }

    return registerWithCode({
      actor,
      characterId: String(formData.get('characterId') ?? ''),
      code: String(formData.get('code') ?? ''),
      settings: await getSettings(actor.guildId),
      fingerprints: await getRequestFingerprint(),
      now,
    })
  })

  if (result.ok) {
    revalidatePath('/dashboard')
    revalidatePath('/events')
  }
  return result
}

export async function createEventAction(
  _previous: ActionResult<{ code: string; eventId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ code: string; eventId: string }>> {
  const result = await runAction(async () => {
    const { actor, now } = await requireAdmin()
    const { event, code } = await createEvent({
      actor,
      settings: await getSettings(actor.guildId),
      input: {
        name: String(formData.get('name') ?? ''),
        description: String(formData.get('description') ?? '') || null,
        pointsValue: Number(formData.get('pointsValue') ?? 0),
        ttlMinutes: Number(formData.get('ttlMinutes')) || 60,
        minParticipants: formData.get('minParticipants')
          ? Number(formData.get('minParticipants'))
          : undefined,
      },
      now,
    })
    // The plaintext code is returned exactly once and never stored.
    return { code, eventId: event.id }
  })

  if (result.ok) revalidatePath('/admin/events')
  return result
}

export async function changeEventPointsAction(
  _previous: ActionResult<{ delta: number; affected: number }> | null,
  formData: FormData,
): Promise<ActionResult<{ delta: number; affected: number }>> {
  const result = await runAction(async () => {
    const { actor, now } = await requireAdmin()
    return changeEventPoints({
      actor,
      eventId: String(formData.get('eventId') ?? ''),
      newPoints: Number(formData.get('newPoints') ?? 0),
      reason: String(formData.get('reason') ?? ''),
      now,
    })
  })

  if (result.ok) {
    revalidatePath('/admin/events')
    revalidatePath('/dashboard')
  }
  return result
}

export async function rotateEventCodeAction(
  _previous: ActionResult<{ code: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ code: string }>> {
  const result = await runAction(async () => {
    const { actor, now } = await requireAdmin()
    return rotateEventCode({ actor, eventId: String(formData.get('eventId') ?? ''), now })
  })

  if (result.ok) revalidatePath('/admin/events')
  return result
}

export async function cancelEventAction(
  _previous: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    const { actor, now } = await requireAdmin()
    await cancelEvent({
      actor,
      eventId: String(formData.get('eventId') ?? ''),
      reason: String(formData.get('reason') ?? ''),
      force: formData.get('force') === 'on',
      now,
    })
    return null
  })

  if (result.ok) {
    revalidatePath('/admin/events')
    revalidatePath('/dashboard')
  }
  return result
}

export async function grantPointsAction(
  _previous: ActionResult<RegistrationOutcome & { needsSecondApproval: boolean }> | null,
  formData: FormData,
): Promise<ActionResult<RegistrationOutcome & { needsSecondApproval: boolean }>> {
  const result = await runAction(async () => {
    const { actor, now } = await requireAdmin()
    return grantEventPoints({
      actor,
      eventId: String(formData.get('eventId') ?? ''),
      characterId: String(formData.get('characterId') ?? ''),
      reason: String(formData.get('reason') ?? ''),
      settings: await getSettings(actor.guildId),
      fingerprints: await getRequestFingerprint(),
      now,
    })
  })

  if (result.ok) {
    revalidatePath('/admin/events')
    revalidatePath('/admin')
  }
  return result
}
