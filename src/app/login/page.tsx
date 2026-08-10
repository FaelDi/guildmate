'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { signInAction } from '@/app/actions/auth'
import { FormMessage, SubmitButton } from '@/components/form'
import { Field, Input, Panel } from '@/components/ui'

export default function LoginPage() {
  const [state, formAction] = useActionState(signInAction, null)

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <Link href="/" className="mb-6 font-mono text-[11px] uppercase tracking-[0.3em] text-plasma">
        GuildMate
      </Link>

      <Panel title="Sign in">
        <form action={formAction} className="space-y-4">
          <Field label="Email">
            <Input name="email" type="email" required autoComplete="email" />
          </Field>

          <Field label="Password">
            <Input name="password" type="password" required autoComplete="current-password" />
          </Field>

          <FormMessage state={state} />

          <SubmitButton className="w-full">Sign in</SubmitButton>
        </form>
      </Panel>

      <p className="mt-5 text-center text-xs text-muted">
        No account yet?{' '}
        <Link href="/register" className="text-plasma hover:underline">
          Join a guild
        </Link>
      </p>
    </main>
  )
}
