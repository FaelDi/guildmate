'use server'

import { revalidatePath } from 'next/cache'
import { runAction, type ActionResult } from '@/lib/errors'
import { requireSession } from '@/lib/session'
import { issueInvite, revokeInvite } from '@/services/invites'

/**
 * Guild invites. Both actions are super-admin only, enforced in the service
 * against the live `users` row - a leader cannot mint guilds.
 */

export type IssuedInvite = { id: string; token: string; expiresAt: string }

export async function issueInviteAction(
  _previous: ActionResult<IssuedInvite> | null,
  formData: FormData,
): Promise<ActionResult<IssuedInvite>> {
  const result = await runAction(async () => {
    const { actor, now } = await requireSession()
    const invite = await issueInvite({
      actor,
      note: String(formData.get('note') ?? '') || undefined,
      now,
    })
    // The token is returned once, here. Nothing stores it.
    return { id: invite.id, token: invite.token, expiresAt: invite.expiresAt.toISOString() }
  })

  if (result.ok) revalidatePath('/admin/invites')
  return result
}

export async function revokeInviteAction(
  _previous: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    const { actor, now } = await requireSession()
    await revokeInvite({ actor, inviteId: String(formData.get('inviteId') ?? ''), now })
    return null
  })

  if (result.ok) revalidatePath('/admin/invites')
  return result
}
