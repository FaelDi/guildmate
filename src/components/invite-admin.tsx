'use client'

import { useActionState } from 'react'
import { issueInviteAction, revokeInviteAction } from '@/app/actions/invites'
import { FormMessage, SubmitButton } from '@/components/form'
import { Field, Input } from '@/components/ui'

/**
 * Issuing an invite shows the link exactly once. Only its digest is stored, so
 * there is no screen anywhere that can show it again - losing it means issuing
 * a new one, which is the same trade the event join codes make.
 */
export function IssueInviteForm({ origin }: { origin: string }) {
  const [state, formAction] = useActionState(issueInviteAction, null)

  return (
    <form action={formAction} className="space-y-4">
      <Field label="Note" hint="Who is this for? Shown in the list, never to the recipient.">
        <Input name="note" maxLength={200} placeholder="Rafa — BRAZUKAS" />
      </Field>

      <SubmitButton>Issue invite</SubmitButton>

      {state?.ok ? (
        <div className="notch-control space-y-2 border border-ore/45 bg-ore/10 p-3">
          <p className="text-[11px] uppercase tracking-[0.14em] text-ore">
            Copy this link now — it is shown once
          </p>
          <code className="block break-all font-mono text-xs text-ink">
            {origin}/register/guild?token={state.data.token}
          </code>
          <p className="text-[11px] text-muted">
            Expires {new Date(state.data.expiresAt).toISOString().slice(0, 16).replace('T', ' ')} UTC
          </p>
        </div>
      ) : (
        <FormMessage state={state} />
      )}
    </form>
  )
}

export function RevokeInviteButton({ inviteId }: { inviteId: string }) {
  const [state, formAction] = useActionState(revokeInviteAction, null)

  return (
    <form action={formAction} className="space-y-1">
      <input type="hidden" name="inviteId" value={inviteId} />
      <SubmitButton variant="danger">Revoke</SubmitButton>
      <FormMessage state={state} />
    </form>
  )
}
