'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { registerAction } from '@/app/actions/auth'
import { CharacterFields } from '@/components/character-fields'
import { FormMessage, SubmitButton } from '@/components/form'
import { Field, Input, Panel } from '@/components/ui'

export default function RegisterPage() {
  const [state, formAction] = useActionState(registerAction, null)

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-16">
      <Link href="/" className="mb-6 font-mono text-[11px] uppercase tracking-[0.3em] text-plasma">
        GuildMate
      </Link>

      <Panel title="Join a guild" subtitle="Your account and your first character.">
        <form action={formAction} className="space-y-4">
          <Field label="Guild" hint="The guild identifier your leader gave you.">
            <Input name="guildSlug" required placeholder="crimson-legion" />
          </Field>

          <Field label="Email">
            <Input name="email" type="email" required autoComplete="email" />
          </Field>

          <Field label="Password" hint="At least 10 characters.">
            <Input name="password" type="password" required minLength={10} autoComplete="new-password" />
          </Field>

          <div className="border-t border-edge pt-4">
            <CharacterFields />
          </div>

          <FormMessage state={state} />

          <SubmitButton className="w-full">Create account</SubmitButton>
        </form>
      </Panel>

      <p className="mt-5 text-center text-xs text-muted">
        Already a member?{' '}
        <Link href="/login" className="text-plasma hover:underline">
          Sign in
        </Link>
      </p>
    </main>
  )
}
