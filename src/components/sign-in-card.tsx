'use client'

import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import { signInAction } from '@/app/actions/auth'
import { useDictionary, useErrorMessage } from '@/components/locale-provider'

/**
 * The "Acesso Restrito" card. Unlike the shared password it replaces, every
 * member signs in with their own account, so what they may change is decided
 * by who they are.
 *
 * Submitted as JSON from here, so a browser with our JavaScript blocked can
 * never post it blind and end up looking at a raw server response.
 */
export function SignInCard() {
  const t = useDictionary()
  const translate = useErrorMessage()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return

    const form = new FormData(event.currentTarget)
    setPending(true)
    setError(null)
    try {
      const result = await signInAction({
        email: String(form.get('email') ?? ''),
        password: String(form.get('password') ?? ''),
      })
      // Success redirects server-side; only a denial comes back.
      if (!result.ok) setError(translate(result.code, result.message))
    } catch {
      setError(translate('SERVICE_UNAVAILABLE', 'Connection failure.'))
    } finally {
      setPending(false)
    }
  }

  return (
    <div
      className="modal-content"
      style={{ width: 450, maxWidth: '100%', margin: '40px auto', textAlign: 'center', borderColor: 'var(--neon-red)' }}
    >
      <h2 style={{ color: 'var(--neon-red)', textShadow: '0 0 10px rgba(255,0,60,0.5)' }}>{t.vx.restrictedTitle}</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 16 }}>{t.vx.restrictedHint}</p>

      <form onSubmit={submit} style={{ display: 'grid', gap: 15, marginTop: 20 }}>
        <noscript>
          <p style={{ color: 'var(--neon-red)', fontSize: 15 }}>{t.vx.needsJavaScript}</p>
        </noscript>

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

        {error && (
          <p className="toast toast-erro show" style={{ position: 'static' }}>
            <span className="toast-icon">✖</span>
            <span className="toast-msg">{error}</span>
          </p>
        )}

        <div style={{ display: 'flex', gap: 15, justifyContent: 'center' }}>
          <button type="submit" className="btn btn-red" disabled={pending}>
            {pending ? t.common.working : t.vx.authenticate}
          </button>
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
