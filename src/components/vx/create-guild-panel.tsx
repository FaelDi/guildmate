'use client'

import { useActionState } from 'react'
import { createGuildAction } from '@/app/actions/invites'
import { FormMessage, SubmitButton } from '@/components/form'
import { useDictionary } from '@/components/locale-provider'

/**
 * Creating another guild on this deployment. Super admin only, enforced in the
 * service; the leader link it returns is shown exactly once, because only its
 * digest is stored.
 */
export function CreateGuildPanel({ origin }: { origin: string }) {
  const [state, formAction] = useActionState(createGuildAction, null)
  const t = useDictionary().vx

  return (
    <div className="table-container" style={{ borderLeftColor: 'var(--neon-green)' }}>
      <h2 style={{ color: 'var(--neon-green)', textShadow: 'none' }}>{t.createGuildTitle}</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 15, marginTop: -10 }}>{t.createGuildHint}</p>

      <form action={formAction} style={{ display: 'grid', gap: 12, maxWidth: 560 }}>
        <label className="field-label">{t.guildName}</label>
        <input name="name" className="input-edit" required minLength={2} maxLength={60} style={{ textAlign: 'left' }} />

        <label className="field-label">{t.guildTag}</label>
        <input name="tag" className="input-edit" maxLength={8} style={{ textAlign: 'left' }} />

        <label className="field-label">{t.guildNote}</label>
        <input name="note" className="input-edit" maxLength={200} style={{ textAlign: 'left' }} />

        <SubmitButton>{t.createGuild}</SubmitButton>

        {state?.ok ? (
          <div
            style={{
              border: '1px solid var(--neon-green)',
              background: 'rgba(0,255,102,0.08)',
              padding: 12,
              display: 'grid',
              gap: 8,
            }}
          >
            <p style={{ color: 'var(--neon-green)', fontSize: 14, margin: 0, letterSpacing: 1 }}>
              {t.leaderLinkOnce}
            </p>
            <code style={{ wordBreak: 'break-all', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
              {origin}/register?token={state.data.token}
            </code>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
              /{state.data.slug} · {t.expires}{' '}
              {new Date(state.data.expiresAt).toISOString().slice(0, 16).replace('T', ' ')} UTC
            </p>
          </div>
        ) : (
          <FormMessage state={state} />
        )}
      </form>
    </div>
  )
}
