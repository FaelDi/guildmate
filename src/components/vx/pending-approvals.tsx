'use client'

import { useActionState, useState } from 'react'
import { approveMemberAction, rejectMemberAction } from '@/app/actions/admin'
import { FormMessage, SubmitButton } from '@/components/form'
import { useDictionary } from '@/components/locale-provider'
import { formatBrt } from './format'

export type PendingMember = {
  id: string
  email: string
  characterName: string | null
  characterLevel: number | null
  createdAt: string
}

/**
 * The sign-up queue. Anyone may create an account; nobody is in the guild
 * until a leader or the super admin says so here, which is what keeps people
 * who do not play with the guild out of the board.
 */
export function PendingApprovals({ members }: { members: PendingMember[] }) {
  const t = useDictionary().vx

  return (
    <div className="table-container" style={{ borderLeftColor: 'var(--neon-orange)' }}>
      <h2 style={{ color: 'var(--neon-orange)', textShadow: 'none' }}>
        {t.approvalsTitle}
        {members.length > 0 && (
          <span
            style={{
              background: 'rgba(255,170,0,0.15)',
              border: '1px solid var(--neon-orange)',
              borderRadius: 4,
              fontSize: 16,
              padding: '2px 10px',
            }}
          >
            {members.length}
          </span>
        )}
      </h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 15, marginTop: -10 }}>{t.approvalsHint}</p>

      {members.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 16 }}>{t.approvalsEmpty}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th className="left">{t.approvalsHead.character}</th>
              <th className="left">{t.approvalsHead.account}</th>
              <th>{t.approvalsHead.since}</th>
              <th style={{ width: 280 }}>{t.approvalsHead.decision}</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <PendingRow key={member.id} member={member} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function PendingRow({ member }: { member: PendingMember }) {
  const t = useDictionary().vx
  const [approveState, approveAction] = useActionState(approveMemberAction, null)
  const [rejectState, rejectAction] = useActionState(rejectMemberAction, null)
  const [rejecting, setRejecting] = useState(false)

  return (
    <tr>
      <td className="left" style={{ color: '#fff', fontWeight: 700, fontSize: 20 }}>
        {member.characterName ?? '—'}
        {member.characterLevel !== null && (
          <span style={{ color: 'var(--text-muted)', fontSize: 15, marginLeft: 8 }}>
            Lv {member.characterLevel}
          </span>
        )}
      </td>
      <td className="left" style={{ color: 'var(--text-muted)', fontSize: 15 }}>{member.email}</td>
      <td style={{ color: 'var(--text-muted)', fontSize: 15 }}>{formatBrt(member.createdAt)}</td>
      <td style={{ whiteSpace: 'normal' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <form action={approveAction}>
            <input type="hidden" name="userId" value={member.id} />
            <SubmitButton className="btn-sm">{t.approve}</SubmitButton>
          </form>

          {rejecting ? (
            <form action={rejectAction} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <input type="hidden" name="userId" value={member.id} />
              <input
                name="reason"
                className="input-edit"
                required
                minLength={3}
                maxLength={200}
                placeholder={t.rejectReason}
                style={{ width: 180, textAlign: 'left', fontSize: 14 }}
              />
              <SubmitButton variant="danger" className="btn-sm">
                {t.confirm}
              </SubmitButton>
            </form>
          ) : (
            <button type="button" className="btn btn-red btn-sm" onClick={() => setRejecting(true)}>
              {t.reject}
            </button>
          )}
        </div>
        <FormMessage state={approveState} />
        <FormMessage state={rejectState} />
      </td>
    </tr>
  )
}
