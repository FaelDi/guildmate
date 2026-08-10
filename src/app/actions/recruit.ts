'use server'

import { revalidatePath } from 'next/cache'
import { runAction, type ActionResult } from '@/lib/errors'
import { requireSession } from '@/lib/session'
import { issueMemberInvite, revokeMemberInvite, setJoinPolicy } from '@/services/member-invites'

/**
 * Recruitment: the links that let somebody join this guild, and the switch
 * that decides whether a link is required at all.
 *
 * Every one of these is guild-admin only, enforced in the service against the
 * live `users` row, and always scoped to the caller's own guild - the guild id
 * is never read from the form.
 */

export type IssuedMemberInvite = {
  id: string
  token: string
  expiresAt: string
  maxUses: number
}

export async function issueMemberInviteAction(
  _previous: ActionResult<IssuedMemberInvite> | null,
  formData: FormData,
): Promise<ActionResult<IssuedMemberInvite>> {
  const result = await runAction(async () => {
    const { actor, now } = await requireSession()
    const invite = await issueMemberInvite({
      actor,
      input: {
        note: String(formData.get('note') ?? '') || undefined,
        // `|| 0` so a non-numeric value reaches the rule and comes back as a
        // field message instead of a generic failure.
        maxUses: Number(formData.get('maxUses')) || 0,
        ttlHours: Number(formData.get('ttlHours')) || 0,
      },
      now,
    })

    return {
      id: invite.id,
      token: invite.token,
      expiresAt: invite.expiresAt.toISOString(),
      maxUses: invite.maxUses,
    }
  })

  if (result.ok) revalidatePath('/admin/recruit')
  return result
}

export async function revokeMemberInviteAction(
  _previous: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    const { actor, now } = await requireSession()
    await revokeMemberInvite({ actor, inviteId: String(formData.get('inviteId') ?? ''), now })
    return null
  })

  if (result.ok) revalidatePath('/admin/recruit')
  return result
}

export async function setJoinPolicyAction(
  _previous: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    const { actor, now } = await requireSession()
    await setJoinPolicy({
      actor,
      policy: formData.get('policy') === 'INVITE_ONLY' ? 'INVITE_ONLY' : 'OPEN',
      now,
    })
    return null
  })

  if (result.ok) {
    revalidatePath('/admin/recruit')
    // The public directory shows which guilds are taking sign-ups.
    revalidatePath('/register')
  }
  return result
}
