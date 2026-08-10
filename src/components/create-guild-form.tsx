'use client'

import { useActionState } from 'react'
import { createGuildAction } from '@/app/actions/auth'
import { CharacterFields } from '@/components/character-fields'
import { FormMessage, SubmitButton } from '@/components/form'
import { useDictionary } from '@/components/locale-provider'
import { Field, Input } from '@/components/ui'

/**
 * Redeeming an invite: the guild, the leader account and the leader's main
 * character are created together, in one transaction, or not at all.
 */
export function CreateGuildForm({ token }: { token: string }) {
  const [state, formAction] = useActionState(createGuildAction, null)
  const t = useDictionary()

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />

      <Field label={t.invite.guildName} hint={t.invite.guildNameHint}>
        <Input name="guildName" required minLength={3} maxLength={80} />
      </Field>

      <Field label={t.invite.tag} hint={t.invite.tagHint}>
        <Input name="guildTag" maxLength={8} placeholder="BR" />
      </Field>

      <div className="border-t border-edge pt-4">
        <Field label={t.common.email}>
          <Input name="email" type="email" required autoComplete="email" />
        </Field>
      </div>

      <Field label={t.common.password} hint={t.auth.passwordHint}>
        <Input name="password" type="password" required minLength={10} autoComplete="new-password" />
      </Field>

      <div className="border-t border-edge pt-4">
        <CharacterFields lockKind="MAIN" />
      </div>

      <FormMessage state={state} />

      <SubmitButton className="w-full">{t.invite.submit}</SubmitButton>
    </form>
  )
}
