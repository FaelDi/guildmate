'use client'

import { useActionState } from 'react'
import { redeemCodeAction } from '@/app/actions/events'
import { FormMessage, SubmitButton } from '@/components/form'
import { Field, Input, Select } from '@/components/ui'

export type CharacterOption = { id: string; name: string; kind: string; level: number }

export function RedeemCodeForm({ characters }: { characters: CharacterOption[] }) {
  const [state, formAction] = useActionState(redeemCodeAction, null)

  if (characters.length === 0) {
    return <p className="text-sm text-muted">Create a character before registering for events.</p>
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Character">
          <Select name="characterId" required>
            {characters.map((character) => (
              <option key={character.id} value={character.id}>
                {character.name} — {character.kind} lv{character.level}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Event code" hint="Case does not matter; dashes are ignored.">
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
                +{state.data.pointsAwarded} points
              </strong>{' '}
              for {state.data.eventName}.{' '}
              {state.data.confirmed ? (
                <>The event is confirmed, so these points are spendable now.</>
              ) : (
                <>
                  Pending: {state.data.registrationsSoFar}/{state.data.minParticipants}{' '}
                  registrations. Points become spendable once the event reaches quorum.
                </>
              )}
            </>
          ) : null
        }
      />

      <SubmitButton>Register</SubmitButton>
    </form>
  )
}
