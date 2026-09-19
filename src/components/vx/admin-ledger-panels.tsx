'use client'

import { reversePenaltyAction, revokeExcuseAction } from '@/app/actions/vortex'
import { useDictionary } from '@/components/locale-provider'
import { formatBrt } from './format'
import { useActionRunner } from './use-action'

type Excuse = { id: string; name: string; eventsExcused: number; reason: string; createdAt: string }
type Penalty = {
  id: string
  name: string
  amount: number
  reason: string
  createdAt: string
  reversed: boolean
}

/** This week's excused absences and the recent penalties, for admins. */
export function AdminLedgerPanels({ excuses, penalties }: { excuses: Excuse[]; penalties: Penalty[] }) {
  const t = useDictionary().vx
  const { run, pending } = useActionRunner()

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(480px, 100%), 1fr))', gap: 20 }}>
      <div className="table-container" style={{ borderLeftColor: 'var(--neon-green)' }}>
        <h2 style={{ color: 'var(--neon-green)', textShadow: 'none' }}>{t.excusesTitle}</h2>
        <table>
          <tbody>
            {excuses.length === 0 && (
              <tr>
                <td style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{t.empty}</td>
              </tr>
            )}
            {excuses.map((excuse) => (
              <tr key={excuse.id}>
                <td className="left" style={{ fontSize: 16 }}>
                  <b>{excuse.name}</b> +{excuse.eventsExcused}
                  <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>
                    {excuse.reason} · {formatBrt(excuse.createdAt)}
                  </div>
                </td>
                <td style={{ width: 60 }}>
                  <button
                    type="button"
                    className="btn-danger"
                    title={t.excuseRevoke}
                    disabled={pending}
                    onClick={() => {
                      if (window.confirm(t.excuseRevokeConfirm)) {
                        run(() => revokeExcuseAction({ excuseId: excuse.id }), t.excuseRevoked)
                      }
                    }}
                  >
                    ✖
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="table-container" style={{ borderLeftColor: 'var(--neon-red)' }}>
        <h2 style={{ color: 'var(--neon-red)', textShadow: 'none' }}>{t.penaltiesTitle}</h2>
        <table>
          <tbody>
            {penalties.length === 0 && (
              <tr>
                <td style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{t.empty}</td>
              </tr>
            )}
            {penalties.map((penalty) => (
              <tr key={penalty.id} style={{ opacity: penalty.reversed ? 0.5 : 1 }}>
                <td className="left" style={{ fontSize: 16 }}>
                  <b>{penalty.name}</b>{' '}
                  <span style={{ color: 'var(--neon-red)' }}>{penalty.amount}</span>
                  <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>
                    {penalty.reason} · {formatBrt(penalty.createdAt)}
                  </div>
                </td>
                <td style={{ width: 110 }}>
                  {penalty.reversed ? (
                    <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>{t.reversed}</span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={pending}
                      onClick={() => {
                        if (window.confirm(t.penaltyReverseConfirm)) {
                          run(() => reversePenaltyAction({ penaltyId: penalty.id }), t.penaltyReversed)
                        }
                      }}
                    >
                      {t.penaltyReverse}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
