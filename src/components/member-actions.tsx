'use client'

import { useActionState, useState } from 'react'
import {
  applyRestrictionAction,
  changeRoleAction,
  revokeAccessAction,
  setMemberActiveAction,
} from '@/app/actions/admin'
import { FormMessage, SubmitButton } from '@/components/form'
import { useDictionary } from '@/components/locale-provider'
import { Field, Input, Select } from '@/components/ui'

type Member = { id: string; email: string; role: string; isActive: boolean; deletedAt: Date | null }

/**
 * The moderation panel for one member. Every control posts to a server action
 * that independently re-checks the admin role and the rank rule, so nothing
 * here is trusted.
 */
export function MemberActions({ member }: { member: Member }) {
  const [open, setOpen] = useState(false)
  const t = useDictionary()

  const [restrictState, restrictAction] = useActionState(applyRestrictionAction, null)
  const [activeState, activeFormAction] = useActionState(setMemberActiveAction, null)
  const [roleState, roleAction] = useActionState(changeRoleAction, null)
  const [revokeState, revokeAction] = useActionState(revokeAccessAction, null)

  if (member.deletedAt) {
    return <span className="text-[11px] uppercase tracking-wider text-slag">{t.admin.accessRevoked}</span>
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="notch-control border border-edge px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted transition-colors hover:border-muted/60 hover:text-ink"
      >
        {t.common.manage}
      </button>
    )
  }

  return (
    <div className="w-80 space-y-4 notch-control border border-edge bg-void/70 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.14em] text-muted">
          {t.admin.manageMember} {member.email}
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-muted hover:text-ink"
        >
          {t.common.close}
        </button>
      </div>

      <form action={activeFormAction} className="space-y-2">
        <input type="hidden" name="userId" value={member.id} />
        <input type="hidden" name="isActive" value={String(!member.isActive)} />
        <Input name="reason" placeholder={t.common.reason} required minLength={3} />
        <SubmitButton variant={member.isActive ? 'ghost' : 'primary'} className="w-full">
          {member.isActive ? t.admin.deactivate : t.admin.reactivate}
        </SubmitButton>
        <FormMessage state={activeState} />
      </form>

      <form action={restrictAction} className="space-y-2 border-t border-edge pt-3">
        <input type="hidden" name="userId" value={member.id} />
        <Field label={t.admin.restriction}>
          <Select name="type" defaultValue="BAN">
            <option value="BAN">{t.admin.ban}</option>
            <option value="SUSPENSION">{t.admin.suspension}</option>
            <option value="NO_EVENTS">{t.admin.blockEvents}</option>
            <option value="NO_AUCTION">{t.admin.blockAuctions}</option>
            <option value="NO_MARKET">{t.admin.blockMarket}</option>
          </Select>
        </Field>
        <Field label={t.admin.durationDays} hint={t.admin.durationHint}>
          <Input name="durationDays" type="number" min={0} defaultValue={0} />
        </Field>
        <Input name="reason" placeholder={t.common.reason} required minLength={3} />
        <SubmitButton variant="danger" className="w-full">
          {t.admin.applyRestriction}
        </SubmitButton>
        <FormMessage state={restrictState} success={restrictState?.ok ? t.admin.restrictionApplied : null} />
      </form>

      <form action={roleAction} className="space-y-2 border-t border-edge pt-3">
        <input type="hidden" name="userId" value={member.id} />
        <Field label={t.admin.role}>
          <Select name="role" defaultValue={member.role}>
            <option value="MEMBER">{t.badges.MEMBER}</option>
            <option value="VICE_LEADER">{t.badges.VICE_LEADER}</option>
            <option value="LEADER">{t.badges.LEADER}</option>
          </Select>
        </Field>
        <Input name="reason" placeholder={t.common.reason} required minLength={3} />
        <SubmitButton variant="ghost" className="w-full">
          {t.admin.changeRole}
        </SubmitButton>
        <FormMessage state={roleState} />
      </form>

      <form action={revokeAction} className="space-y-2 border-t border-edge pt-3">
        <input type="hidden" name="userId" value={member.id} />
        <Input
          name="reason"
          placeholder={t.admin.revokeReasonPlaceholder}
          required
          minLength={5}
        />
        <SubmitButton variant="danger" className="w-full">
          {t.admin.revokeAccess}
        </SubmitButton>
        <FormMessage state={revokeState} />
      </form>
    </div>
  )
}
