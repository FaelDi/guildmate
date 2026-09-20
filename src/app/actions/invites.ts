'use server'

import { revalidatePath } from 'next/cache'
import { runAction, type ActionResult } from '@/lib/errors'
import { requireSession } from '@/lib/session'
import { createGuild } from '@/services/guilds'
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

export type CreatedGuild = { slug: string; token: string; expiresAt: string }

/**
 * Creates another guild on this deployment and returns the single-use leader
 * link for it **once**. Super admin only, enforced in the service against the
 * live `users` row.
 */
export async function createGuildAction(
  _previous: ActionResult<CreatedGuild> | null,
  formData: FormData,
): Promise<ActionResult<CreatedGuild>> {
  const result = await runAction(async () => {
    const { actor, now } = await requireSession()
    const created = await createGuild({
      actor,
      name: String(formData.get('name') ?? ''),
      tag: String(formData.get('tag') ?? '') || null,
      note: String(formData.get('note') ?? '') || null,
      now,
    })
    return {
      slug: created.slug,
      token: created.token,
      expiresAt: created.expiresAt.toISOString(),
    }
  })

  if (result.ok) revalidatePath('/admin/invites')
  return result
}
