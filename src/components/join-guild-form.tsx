'use client'

import { useActionState } from 'react'
import { registerAction } from '@/app/actions/auth'
import { CharacterFields } from '@/components/character-fields'
import { FormMessage, SubmitButton } from '@/components/form'
import { useDictionary } from '@/components/locale-provider'
import { Field, Input, Select } from '@/components/ui'

export type JoinableGuild = { slug: string; name: string; tag: string | null }

/**
 * Signing up into an existing guild.
 *
 * The guild is picked from the directory rather than typed: a slug typo used
 * to fail with "that guild does not exist or is not accepting members", which
 * is honest but useless. Guilds that stopped accepting members are not in the
 * list at all, so the choice cannot be wrong.
 */
export function JoinGuildForm({ guilds }: { guilds: JoinableGuild[] }) {
  const [state, formAction] = useActionState(registerAction, null)
  const t = useDictionary()

  if (guilds.length === 0) {
    return (
      <p className="text-sm leading-relaxed text-muted">
        {t.auth.noGuildsYet}
      </p>
    )
  }

  return (
    <form action={formAction} className="space-y-4">
      <Field label={t.common.guild}>
        <Select name="guildSlug" required defaultValue={guilds[0]?.slug}>
          {guilds.map((guild) => (
            <option key={guild.slug} value={guild.slug}>
              {guild.name}
              {guild.tag ? ` [${guild.tag}]` : ''}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={t.common.email}>
        <Input name="email" type="email" required autoComplete="email" />
      </Field>

      <Field label={t.common.password} hint={t.auth.passwordHint}>
        <Input name="password" type="password" required minLength={10} autoComplete="new-password" />
      </Field>

      <div className="border-t border-edge pt-4">
        <CharacterFields />
      </div>

      <FormMessage state={state} />

      <SubmitButton className="w-full">{t.auth.createAccount}</SubmitButton>
    </form>
  )
}
