'use server'

import { revalidatePath } from 'next/cache'
import { runAction, type ActionResult } from '@/lib/errors'
import { requireAdmin } from '@/lib/session'
import type { RestrictionType, UserRole } from '@/db/schema'
import {
  applyRestriction,
  changeMemberRole,
  revokeAccessPermanently,
  revokeRestriction,
  setMemberActive,
} from '@/services/moderation'

/**
 * Moderation entry points. Each one re-checks the admin role AND the rank rule
 * inside the service, so a stale page or a forged form field cannot escalate.
 */

export async function setMemberActiveAction(
  _previous: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    const { actor, now } = await requireAdmin()
    await setMemberActive({
      actor,
      userId: String(formData.get('userId') ?? ''),
      isActive: formData.get('isActive') === 'true',
      reason: String(formData.get('reason') ?? ''),
      now,
    })
    return null
  })

  if (result.ok) revalidatePath('/admin')
  return result
}

export async function applyRestrictionAction(
  _previous: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const result = await runAction(async () => {
    const { actor, now } = await requireAdmin()
    const days = Number(formData.get('durationDays') ?? 0)

    return applyRestriction({
      actor,
      userId: String(formData.get('userId') ?? ''),
      type: String(formData.get('type') ?? 'BAN') as RestrictionType,
      reason: String(formData.get('reason') ?? ''),
      // 0 days means permanent.
      expiresAt: days > 0 ? new Date(now.getTime() + days * 24 * 3_600_000) : null,
      now,
    })
  })

  if (result.ok) revalidatePath('/admin')
  return result
}

export async function revokeRestrictionAction(
  _previous: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    const { actor, now } = await requireAdmin()
    await revokeRestriction({
      actor,
      restrictionId: String(formData.get('restrictionId') ?? ''),
      reason: String(formData.get('reason') ?? ''),
      now,
    })
    return null
  })

  if (result.ok) revalidatePath('/admin')
  return result
}

export async function revokeAccessAction(
  _previous: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    const { actor, now } = await requireAdmin()
    await revokeAccessPermanently({
      actor,
      userId: String(formData.get('userId') ?? ''),
      reason: String(formData.get('reason') ?? ''),
      now,
    })
    return null
  })

  if (result.ok) revalidatePath('/admin')
  return result
}

export async function changeRoleAction(
  _previous: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    const { actor, now } = await requireAdmin()
    await changeMemberRole({
      actor,
      userId: String(formData.get('userId') ?? ''),
      newRole: String(formData.get('role') ?? 'MEMBER') as UserRole,
      reason: String(formData.get('reason') ?? ''),
      now,
    })
    return null
  })

  if (result.ok) revalidatePath('/admin')
  return result
}
