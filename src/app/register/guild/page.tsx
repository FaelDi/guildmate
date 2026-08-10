'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { createGuildAction } from '@/app/actions/auth'
import { CharacterFields } from '@/components/character-fields'
import { FormMessage, SubmitButton } from '@/components/form'
import { Field, Input, Panel } from '@/components/ui'

export default function CreateGuildPage() {
  const [state, formAction] = useActionState(createGuildAction, null)

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-16">
      <Link href="/" className="mb-6 font-mono text-[11px] uppercase tracking-[0.3em] text-ore">
        GuildMate
      </Link>

      <Panel
        title="Create a guild"
        subtitle="You become the leader. This is the only way a leader is created."
      >
        <form action={formAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <Field label="Guild name">
              <Input name="guildName" required minLength={3} maxLength={80} />
            </Field>
            <Field label="Tag">
              <Input name="guildTag" maxLength={8} className="sm:w-24" />
            </Field>
          </div>

          <Field label="Email">
            <Input name="email" type="email" required autoComplete="email" />
          </Field>

          <Field label="Password" hint="At least 10 characters.">
            <Input name="password" type="password" required minLength={10} autoComplete="new-password" />
          </Field>

          <div className="border-t border-edge pt-4">
            <CharacterFields lockKind="MAIN" />
          </div>

          <FormMessage state={state} />

          <SubmitButton className="w-full">Create guild</SubmitButton>
        </form>
      </Panel>
    </main>
  )
}
