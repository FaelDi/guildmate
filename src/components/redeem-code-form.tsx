'use client'

import { useActionState } from 'react'
import { redeemCodeAction } from '@/app/actions/events'
import { FormMessage, SubmitButton } from '@/components/form'
import { useDictionary } from '@/components/locale-provider'
import { Field, Input, Select } from '@/components/ui'

export type CharacterOption = { id: string; name: string; kind: string; level: number }

export function RedeemCodeForm({ characters }: { characters: CharacterOption[] }) {
  const [state, formAction] = useActionState(redeemCodeAction, null)
  const t = useDictionary()

  if (characters.length === 0) {
    return <p className="text-sm text-muted">{t.redeem.needCharacter}</p>
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.common.character}>
          <Select name="characterId" required>
            {characters.map((character) => (
              <option key={character.id} value={character.id}>
                {character.name} — {character.kind} lv{character.level}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t.redeem.code} hint={t.redeem.codeHint}>
          <Input
            name="code"
            required
            autoComplete="off"
            spellCheck={false}
            placeholder="AB2K9XZQ"
            className="font-mono uppercase tracking-[0.2em]"
          />
        </Field>
      </div>

      <FormMessage
        state={state}
        success={
          state?.ok ? (
            <>
              <strong className="font-semibold">
                +{state.data.pointsAwarded} {t.redeem.awarded}
              </strong>{' '}
              {t.redeem.for} {state.data.eventName}.{' '}
              {state.data.confirmed ? (
                <>{t.redeem.confirmed}</>
              ) : (
                <>
                  {t.redeem.pendingPrefix} {state.data.registrationsSoFar}/
                  {state.data.minParticipants} {t.redeem.pendingSuffix}
                </>
              )}
            </>
          ) : null
        }
      />

      <SubmitButton>{t.redeem.submit}</SubmitButton>
    </form>
  )
}
