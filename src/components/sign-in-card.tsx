'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { signInAction } from '@/app/actions/auth'
import { FormMessage, SubmitButton } from '@/components/form'
import { useDictionary } from '@/components/locale-provider'

/**
 * The "Acesso Restrito" card. Unlike the shared password it replaces, every
 * member signs in with their own account, so what they may change is decided
 * by who they are.
 */
export function SignInCard() {
  const [state, formAction] = useActionState(signInAction, null)
  const t = useDictionary()

  return (
    <div
      className="modal-content"
      style={{ width: 450, maxWidth: '100%', margin: '40px auto', textAlign: 'center', borderColor: 'var(--neon-red)' }}
    >
      <h2 style={{ color: 'var(--neon-red)', textShadow: '0 0 10px rgba(255,0,60,0.5)' }}>{t.vx.restrictedTitle}</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 16 }}>{t.vx.restrictedHint}</p>

      <form action={formAction} style={{ display: 'grid', gap: 15, marginTop: 20 }}>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder={t.common.email}
          className="input-edit"
          style={{ fontSize: 18, borderColor: 'rgba(255,0,60,0.5)' }}
        />
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          placeholder="********"
          className="input-edit"
          style={{ fontSize: 22, letterSpacing: 5, borderColor: 'rgba(255,0,60,0.5)' }}
        />

        <FormMessage state={state} />

        <div style={{ display: 'flex', gap: 15, justifyContent: 'center' }}>
          <SubmitButton variant="danger">{t.vx.authenticate}</SubmitButton>
        </div>
      </form>

      <p style={{ marginTop: 20, color: 'var(--text-muted)', fontSize: 15 }}>
        {t.auth.noAccount}{' '}
        <Link href="/register" style={{ color: 'var(--neon-cyan)' }}>
          {t.auth.createAccount}
        </Link>
      </p>
    </div>
  )
}
