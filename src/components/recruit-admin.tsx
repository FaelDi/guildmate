'use client'

import { useActionState } from 'react'
import {
  issueMemberInviteAction,
  revokeMemberInviteAction,
  setJoinPolicyAction,
} from '@/app/actions/recruit'
import { FormMessage, SubmitButton } from '@/components/form'
import { useDictionary } from '@/components/locale-provider'
import { Field, Input, Select } from '@/components/ui'

/**
 * The two halves of recruitment: the door policy, and the links.
 *
 * Issuing shows the URL exactly once. Only its digest is stored, so no screen
 * anywhere can show it again - the same trade the event join codes make.
 */
export function JoinPolicyForm({ current }: { current: 'OPEN' | 'INVITE_ONLY' }) {
  const [state, formAction] = useActionState(setJoinPolicyAction, null)
  const t = useDictionary()

  return (
    <form action={formAction} className="space-y-4">
      <Field
        label={t.recruit.policyTitle}
        hint={current === 'OPEN' ? t.recruit.policyOpenHint : t.recruit.policyInviteOnlyHint}
      >
        <Select name="policy" defaultValue={current}>
          <option value="OPEN">{t.recruit.policyOpen}</option>
          <option value="INVITE_ONLY">{t.recruit.policyInviteOnly}</option>
        </Select>
      </Field>

      <SubmitButton variant="ghost">{t.recruit.policySave}</SubmitButton>
      <FormMessage state={state} success={state?.ok ? t.recruit.policySaved : null} />
    </form>
  )
}

export function IssueMemberInviteForm({ origin }: { origin: string }) {
  const [state, formAction] = useActionState(issueMemberInviteAction, null)
  const t = useDictionary()

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.recruit.seats} hint={t.recruit.seatsHint}>
          <Input
            name="maxUses"
            type="number"
            min={1}
            max={100}
            defaultValue={1}
            required
            className="font-mono tabular-nums"
          />
        </Field>

        <Field label={t.recruit.ttl} hint={t.recruit.ttlHint}>
          <Input
            name="ttlHours"
            type="number"
            min={1}
            max={720}
            defaultValue={24}
            required
            className="font-mono tabular-nums"
          />
        </Field>
      </div>

      <Field label={t.recruit.note}>
        <Input name="note" maxLength={200} placeholder={t.recruit.notePlaceholder} />
      </Field>

      <SubmitButton>{t.recruit.issue}</SubmitButton>

      {state?.ok ? (
        <div className="notch-control space-y-2 border border-ore/45 bg-ore/10 p-3">
          <p className="text-[11px] uppercase tracking-[0.14em] text-ore">{t.recruit.copyOnce}</p>
          <code className="block break-all font-mono text-xs text-ink">
            {origin}/register?token={state.data.token}
          </code>
          <p className="text-[11px] text-muted">
            {state.data.maxUses} {t.recruit.seats.toLowerCase()} ·{' '}
            {new Date(state.data.expiresAt).toISOString().slice(0, 16).replace('T', ' ')} UTC
          </p>
        </div>
      ) : (
        <FormMessage state={state} />
      )}
    </form>
  )
}

export function RevokeMemberInviteButton({ inviteId }: { inviteId: string }) {
  const [state, formAction] = useActionState(revokeMemberInviteAction, null)
  const t = useDictionary()

  return (
    <form action={formAction} className="space-y-1">
      <input type="hidden" name="inviteId" value={inviteId} />
      <SubmitButton variant="danger">{t.recruit.revoke}</SubmitButton>
      <FormMessage state={state} />
    </form>
  )
}
