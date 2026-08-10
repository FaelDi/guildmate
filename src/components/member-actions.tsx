'use client'

import { useActionState, useState } from 'react'
import {
  applyRestrictionAction,
  changeRoleAction,
  revokeAccessAction,
  setMemberActiveAction,
} from '@/app/actions/admin'
import { FormMessage, SubmitButton } from '@/components/form'
import { Field, Input, Select } from '@/components/ui'

type Member = { id: string; email: string; role: string; isActive: boolean; deletedAt: Date | null }

/**
 * The moderation panel for one member. Every control posts to a server action
 * that independently re-checks the admin role and the rank rule, so nothing
 * here is trusted.
 */
export function MemberActions({ member }: { member: Member }) {
  const [open, setOpen] = useState(false)

  const [restrictState, restrictAction] = useActionState(applyRestrictionAction, null)
  const [activeState, activeFormAction] = useActionState(setMemberActiveAction, null)
  const [roleState, roleAction] = useActionState(changeRoleAction, null)
  const [revokeState, revokeAction] = useActionState(revokeAccessAction, null)

  if (member.deletedAt) {
    return <span className="text-[11px] uppercase tracking-wider text-blood">access revoked</span>
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-edge px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted transition-colors hover:border-muted/60 hover:text-ink"
      >
        Manage
      </button>
    )
  }

  return (
    <div className="w-80 space-y-4 rounded-md border border-edge bg-void/70 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.14em] text-muted">
          Manage {member.email}
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-muted hover:text-ink"
        >
          close
        </button>
      </div>

      <form action={activeFormAction} className="space-y-2">
        <input type="hidden" name="userId" value={member.id} />
        <input type="hidden" name="isActive" value={String(!member.isActive)} />
        <Input name="reason" placeholder="Reason" required minLength={3} />
        <SubmitButton variant={member.isActive ? 'ghost' : 'primary'} className="w-full">
          {member.isActive ? 'Deactivate' : 'Reactivate'}
        </SubmitButton>
        <FormMessage state={activeState} />
      </form>

      <form action={restrictAction} className="space-y-2 border-t border-edge pt-3">
        <input type="hidden" name="userId" value={member.id} />
        <Field label="Restriction">
          <Select name="type" defaultValue="BAN">
            <option value="BAN">Ban</option>
            <option value="SUSPENSION">Suspension</option>
            <option value="NO_EVENTS">Block events</option>
            <option value="NO_AUCTION">Block auctions</option>
            <option value="NO_MARKET">Block store</option>
          </Select>
        </Field>
        <Field label="Duration (days)" hint="0 means permanent.">
          <Input name="durationDays" type="number" min={0} defaultValue={0} />
        </Field>
        <Input name="reason" placeholder="Reason" required minLength={3} />
        <SubmitButton variant="danger" className="w-full">
          Apply restriction
        </SubmitButton>
        <FormMessage state={restrictState} success={restrictState?.ok ? 'Restriction applied.' : null} />
      </form>

      <form action={roleAction} className="space-y-2 border-t border-edge pt-3">
        <input type="hidden" name="userId" value={member.id} />
        <Field label="Role">
          <Select name="role" defaultValue={member.role}>
            <option value="MEMBER">Member</option>
            <option value="VICE_LEADER">Vice leader</option>
            <option value="LEADER">Leader</option>
          </Select>
        </Field>
        <Input name="reason" placeholder="Reason" required minLength={3} />
        <SubmitButton variant="ghost" className="w-full">
          Change role
        </SubmitButton>
        <FormMessage state={roleState} />
      </form>

      <form action={revokeAction} className="space-y-2 border-t border-edge pt-3">
        <input type="hidden" name="userId" value={member.id} />
        <Input
          name="reason"
          placeholder="Reason (permanent, min 5 chars)"
          required
          minLength={5}
        />
        <SubmitButton variant="danger" className="w-full">
          Revoke access permanently
        </SubmitButton>
        <FormMessage state={revokeState} />
      </form>
    </div>
  )
}
