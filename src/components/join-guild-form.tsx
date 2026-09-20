'use client'

import { useState, type FormEvent } from 'react'
import { registerAction } from '@/app/actions/auth'
import { CharacterFields } from '@/components/character-fields'
import { useDictionary, useErrorMessage } from '@/components/locale-provider'
import { Field } from '@/components/ui'

/**
 * Signing up.
 *
 * There is no guild picker: this deployment belongs to one guild and an open
 * sign-up joins it, waiting for an admin to approve. A recruitment link names
 * its own guild instead - and the server reads the guild from the link, never
 * from anything this form could post.
 *
 * The form is submitted as JSON from here rather than posted as a FormData,
 * so a browser that never ran our JavaScript cannot post it blind and land on
 * a raw server response. The `<noscript>` below says so out loud.
 */
export function JoinGuildForm({
  invite,
}: {
  /** Set when the visitor arrived through a recruitment link. */
  invite?: { token: string; guildName: string } | null
}) {
  const t = useDictionary()
  const translate = useErrorMessage()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return

    const form = new FormData(event.currentTarget)
    setPending(true)
    setError(null)
    try {
      const result = await registerAction({
        email: String(form.get('email') ?? ''),
        password: String(form.get('password') ?? ''),
        characterName: String(form.get('characterName') ?? ''),
        race: String(form.get('race') ?? 'BELLATO'),
        biosuit: String(form.get('biosuit') ?? ''),
        level: Number(form.get('level')) || 0,
        kind: String(form.get('kind') ?? 'MAIN'),
        ...(invite ? { token: invite.token } : {}),
      })
      // A successful approved sign-up redirects, so only these two land here.
      if (result.ok) setDone(true)
      else setError(translate(result.code, result.message))
    } catch {
      setError(translate('SERVICE_UNAVAILABLE', 'Connection failure.'))
    } finally {
      setPending(false)
    }
  }

  if (done) {
    return (
      <p
        style={{
          border: '1px solid var(--neon-green)',
          background: 'rgba(0,255,102,0.08)',
          color: 'var(--neon-green)',
          padding: 14,
          fontSize: 16,
        }}
      >
        {t.vx.signedUp}
      </p>
    )
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
      <noscript>
        <p
          style={{
            border: '1px solid var(--neon-red)',
            background: 'rgba(255,0,60,0.1)',
            color: 'var(--neon-red)',
            padding: 12,
            fontSize: 15,
          }}
        >
          {t.vx.needsJavaScript}
        </p>
      </noscript>

      {invite && (
        <Field label={t.common.guild}>
          <p
            style={{
              border: '1px solid var(--neon-orange)',
              background: 'rgba(255,170,0,0.1)',
              color: 'var(--neon-orange)',
              padding: '8px 12px',
              fontSize: 16,
              margin: 0,
            }}
          >
            {invite.guildName}
          </p>
        </Field>
      )}

      <Field label={t.common.email}>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className="input-edit"
          style={{ textAlign: 'left', width: '100%' }}
        />
      </Field>

      <Field label={t.common.password} hint={t.auth.passwordHint}>
        <input
          name="password"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          className="input-edit"
          style={{ textAlign: 'left', width: '100%' }}
        />
      </Field>

      <CharacterFields />

      {error && (
        <p className="toast toast-erro show" style={{ position: 'static' }}>
          <span className="toast-icon">✖</span>
          <span className="toast-msg">{error}</span>
        </p>
      )}

      <button type="submit" className="btn btn-success" disabled={pending}>
        {pending ? t.common.working : t.auth.createAccount}
      </button>
    </form>
  )
}
