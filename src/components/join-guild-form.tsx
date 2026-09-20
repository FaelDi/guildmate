'use client'

import { useActionState } from 'react'
import { registerAction } from '@/app/actions/auth'
import { CharacterFields } from '@/components/character-fields'
import { FormMessage, SubmitButton } from '@/components/form'
import { useDictionary } from '@/components/locale-provider'
import { Field } from '@/components/ui'

/**
 * Signing up.
 *
 * There is no guild picker: this deployment belongs to one guild and an open
 * sign-up joins it, waiting for an admin to approve. A recruitment link names
 * its own guild instead - and the server reads the guild from the link, never
 * from anything this form could post.
 */
export function JoinGuildForm({
  invite,
}: {
  /** Set when the visitor arrived through a recruitment link. */
  invite?: { token: string; guildName: string } | null
}) {
  const [state, formAction] = useActionState(registerAction, null)
  const t = useDictionary()

  return (
    <form action={formAction} style={{ display: 'grid', gap: 12 }}>
      {invite && (
        <>
          <input type="hidden" name="token" value={invite.token} />
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
        </>
      )}

      <Field label={t.common.email}>
        <input name="email" type="email" required autoComplete="email" className="input-edit" style={{ textAlign: 'left' }} />
      </Field>

      <Field label={t.common.password} hint={t.auth.passwordHint}>
        <input
          name="password"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          className="input-edit"
          style={{ textAlign: 'left' }}
        />
      </Field>

      <CharacterFields />

      <FormMessage state={state} success={state?.ok ? t.vx.signedUp : null} />

      <SubmitButton>{t.auth.createAccount}</SubmitButton>
    </form>
  )
}
