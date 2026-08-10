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
import { useDictionary } from '@/components/locale-provider'
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
  const t = useDictionary()

  if (full) {
    return (
      <p className="text-sm text-muted">
        {t.profile.rosterFull}
      </p>
    )
  }

  return (
    <form action={formAction} className="space-y-4">
      <CharacterFields lockKind={hasMain ? 'ALT' : 'MAIN'} />

      <p className="text-[11px] text-muted">
        {hasMain ? t.profile.addAsAlt : t.profile.addAsMain}
      </p>

      <FormMessage state={state} success={state?.ok ? t.profile.added : null} />

      <SubmitButton>{t.profile.add}</SubmitButton>
    </form>
  )
}

/**
 * The per-character controls. Every one of them posts a character id that the
 * service re-authorizes against the loaded row, so nothing here is trusted.
 */
export function CharacterActions({ character }: { character: RosterCharacter }) {
  const [open, setOpen] = useState(false)

  const t = useDictionary()
  const [updateState, updateFormAction] = useActionState(updateCharacterAction, null)
  const [mainState, mainFormAction] = useActionState(setMainCharacterAction, null)
  const [retireState, retireFormAction] = useActionState(retireCharacterAction, null)

  if (!character.isActive) {
    return <span className="text-[11px] uppercase tracking-wider text-muted">{t.profile.retired}</span>
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="notch-control border border-edge px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted transition-colors hover:border-muted/60 hover:text-ink"
      >
        {t.profile.manage}
      </button>
    )
  }

  return (
    <div className="w-72 space-y-4 notch-control border border-edge bg-void/70 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.14em] text-muted">
          {t.profile.manage} {character.name}
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-muted hover:text-ink"
        >
          {t.common.close}
        </button>
      </div>

      <form action={updateFormAction} className="space-y-2">
        <input type="hidden" name="characterId" value={character.id} />
        <Field label={t.profile.name}>
          <Input
            name="characterName"
            required
            minLength={2}
            maxLength={40}
            defaultValue={character.name}
          />
        </Field>
        <Field label={t.profile.biosuit}>
          <Input name="biosuit" required maxLength={60} defaultValue={character.biosuit} />
        </Field>
        <Field label={t.common.level}>
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
          {t.common.save}
        </SubmitButton>
        <FormMessage state={updateState} success={updateState?.ok ? t.profile.saved : null} />
      </form>

      {character.kind === 'ALT' && (
        <>
          <form action={mainFormAction} className="space-y-2 border-t border-edge pt-3">
            <input type="hidden" name="characterId" value={character.id} />
            <SubmitButton className="w-full">{t.profile.makeMain}</SubmitButton>
            <p className="text-[11px] text-muted">
              {t.profile.makeMainHint}
            </p>
            <FormMessage state={mainState} />
          </form>

          <form action={retireFormAction} className="space-y-2 border-t border-edge pt-3">
            <input type="hidden" name="characterId" value={character.id} />
            <SubmitButton variant="danger" className="w-full">
              {t.profile.retire}
            </SubmitButton>
            <FormMessage state={retireState} />
          </form>
        </>
      )}

      {character.kind === 'MAIN' && (
        <p className="border-t border-edge pt-3 text-[11px] text-muted">
          {t.profile.mainCannotRetire}
        </p>
      )}
    </div>
  )
}
