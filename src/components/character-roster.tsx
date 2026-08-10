'use client'

import { useActionState, useState } from 'react'
import {
  createCharacterAction,
  retireCharacterAction,
  setMainCharacterAction,
  updateCharacterAction,
} from '@/app/actions/characters'
import { CharacterFields } from '@/components/character-fields'
import { FormMessage, SubmitButton } from '@/components/form'
import { Field, Input } from '@/components/ui'

export type RosterCharacter = {
  id: string
  name: string
  kind: 'MAIN' | 'ALT'
  biosuit: string
  level: number
  isActive: boolean
}

/**
 * Adding a character. The type is not offered as a choice: the first character
 * an account has must be its MAIN, and after that only ALTs can be added -
 * changing which one is the MAIN goes through the promote control, which
 * relinks the whole roster in one step.
 */
export function AddCharacterForm({ hasMain, full }: { hasMain: boolean; full: boolean }) {
  const [state, formAction] = useActionState(createCharacterAction, null)

  if (full) {
    return (
      <p className="text-sm text-muted">
        Your roster is full. Retiring a character does not free a slot: it keeps its name
        reserved in the guild.
      </p>
    )
  }

  return (
    <form action={formAction} className="space-y-4">
      <CharacterFields lockKind={hasMain ? 'ALT' : 'MAIN'} />

      <p className="text-[11px] text-muted">
        {hasMain
          ? 'New characters join as alts. Their event points roll up to your main.'
          : 'This will be your main character: the one that bids in auctions.'}
      </p>

      <FormMessage state={state} success={state?.ok ? 'Character added.' : null} />

      <SubmitButton>Add character</SubmitButton>
    </form>
  )
}

/**
 * The per-character controls. Every one of them posts a character id that the
 * service re-authorizes against the loaded row, so nothing here is trusted.
 */
export function CharacterActions({ character }: { character: RosterCharacter }) {
  const [open, setOpen] = useState(false)

  const [updateState, updateFormAction] = useActionState(updateCharacterAction, null)
  const [mainState, mainFormAction] = useActionState(setMainCharacterAction, null)
  const [retireState, retireFormAction] = useActionState(retireCharacterAction, null)

  if (!character.isActive) {
    return <span className="text-[11px] uppercase tracking-wider text-muted">retired</span>
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-edge px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted transition-colors hover:border-muted/60 hover:text-ink"
      >
        Manage
      </button>
    )
  }

  return (
    <div className="w-72 space-y-4 rounded-md border border-edge bg-void/70 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.14em] text-muted">
          Manage {character.name}
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-muted hover:text-ink"
        >
          close
        </button>
      </div>

      <form action={updateFormAction} className="space-y-2">
        <input type="hidden" name="characterId" value={character.id} />
        <Field label="Name">
          <Input
            name="characterName"
            required
            minLength={2}
            maxLength={40}
            defaultValue={character.name}
          />
        </Field>
        <Field label="Biosuit">
          <Input name="biosuit" required maxLength={60} defaultValue={character.biosuit} />
        </Field>
        <Field label="Level">
          <Input
            name="level"
            type="number"
            min={1}
            max={999}
            required
            defaultValue={character.level}
          />
        </Field>
        <SubmitButton variant="ghost" className="w-full">
          Save changes
        </SubmitButton>
        <FormMessage state={updateState} success={updateState?.ok ? 'Saved.' : null} />
      </form>

      {character.kind === 'ALT' && (
        <>
          <form action={mainFormAction} className="space-y-2 border-t border-edge pt-3">
            <input type="hidden" name="characterId" value={character.id} />
            <SubmitButton className="w-full">Make this my main</SubmitButton>
            <p className="text-[11px] text-muted">
              Your current main becomes an alt. Points already earned do not move.
            </p>
            <FormMessage state={mainState} />
          </form>

          <form action={retireFormAction} className="space-y-2 border-t border-edge pt-3">
            <input type="hidden" name="characterId" value={character.id} />
            <SubmitButton variant="danger" className="w-full">
              Retire character
            </SubmitButton>
            <FormMessage state={retireState} />
          </form>
        </>
      )}

      {character.kind === 'MAIN' && (
        <p className="border-t border-edge pt-3 text-[11px] text-muted">
          Promote another character to main before retiring this one.
        </p>
      )}
    </div>
  )
}
