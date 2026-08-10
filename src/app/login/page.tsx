'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { signInAction } from '@/app/actions/auth'
import { FormMessage, SubmitButton } from '@/components/form'
import { useDictionary } from '@/components/locale-provider'
import { Field, Input, Panel } from '@/components/ui'

export default function LoginPage() {
  const [state, formAction] = useActionState(signInAction, null)
  const t = useDictionary()

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <Link href="/" className="mb-6 font-mono text-[11px] uppercase tracking-[0.3em] text-ore">
        GuildMate
      </Link>

      <Panel title={t.auth.signInTitle}>
        <form action={formAction} className="space-y-4">
          <Field label={t.common.email}>
            <Input name="email" type="email" required autoComplete="email" />
          </Field>

          <Field label={t.common.password}>
            <Input name="password" type="password" required autoComplete="current-password" />
          </Field>

          <FormMessage state={state} />

          <SubmitButton className="w-full">{t.common.signIn}</SubmitButton>
        </form>
      </Panel>

      <p className="mt-5 text-center text-xs text-muted">
        {t.auth.noAccount}{' '}
        <Link href="/register" className="text-ore hover:underline">
          {t.landing.joinGuild}
        </Link>
      </p>
    </main>
  )
}
