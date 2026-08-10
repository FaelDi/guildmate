'use client'

import { useActionState } from 'react'
import { createGuildAction } from '@/app/actions/auth'
import { CharacterFields } from '@/components/character-fields'
import { FormMessage, SubmitButton } from '@/components/form'
import { Field, Input } from '@/components/ui'

/**
 * Redeeming an invite: the guild, the leader account and the leader's main
 * character are created together, in one transaction, or not at all.
 */
export function CreateGuildForm({ token }: { token: string }) {
  const [state, formAction] = useActionState(createGuildAction, null)

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />

      <Field label="Guild name" hint="The web address is derived from this.">
        <Input name="guildName" required minLength={3} maxLength={80} />
      </Field>

      <Field label="Tag" hint="Optional. Up to 8 characters.">
        <Input name="guildTag" maxLength={8} placeholder="BR" />
      </Field>

      <div className="border-t border-edge pt-4">
        <Field label="Email">
          <Input name="email" type="email" required autoComplete="email" />
        </Field>
      </div>

      <Field label="Password" hint="At least 10 characters.">
        <Input name="password" type="password" required minLength={10} autoComplete="new-password" />
      </Field>

      <div className="border-t border-edge pt-4">
        <CharacterFields lockKind="MAIN" />
      </div>

      <FormMessage state={state} />

      <SubmitButton className="w-full">Create guild</SubmitButton>
    </form>
  )
}
