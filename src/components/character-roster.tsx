'use client'

import { useActionState, useState } from 'react'
import {
  createCharacterAction,
  retireCharacterAction,
  setMainCharacterAction,
} from '@/app/actions/characters'
import { CharacterFields } from '@/components/character-fields'
import { FormMessage, SubmitButton } from '@/components/form'
import { useDictionary } from '@/components/locale-provider'
import { CharacterEditModal, type EditableCharacter } from '@/components/vx/character-edit'

export type RosterCharacter = EditableCharacter & {
  kind: 'MAIN' | 'ALT'
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
      <p style={{ color: 'var(--text-muted)', fontSize: 16 }}>{t.profile.rosterFull}</p>
    )
  }

  return (
    <form action={formAction} style={{ display: 'grid', gap: 12, maxWidth: 640 }}>
      <CharacterFields lockKind={hasMain ? 'ALT' : 'MAIN'} />

      <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0 }}>
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
  const [editing, setEditing] = useState<'stats' | 'build' | null>(null)

  const t = useDictionary()
  const [mainState, mainFormAction] = useActionState(setMainCharacterAction, null)
  const [retireState, retireFormAction] = useActionState(retireCharacterAction, null)

  if (!character.isActive) {
    return <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>{t.profile.retired}</span>
  }

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <button type="button" className="btn btn-sm" onClick={() => setEditing('stats')}>
        {t.vx.edit}
      </button>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing('build')}>
        ⚔️ Build
      </button>

      {character.kind === 'ALT' && (
        <button type="button" className="btn btn-muted btn-sm" onClick={() => setOpen((v) => !v)}>
          {t.profile.manage}
        </button>
      )}

      {open && character.kind === 'ALT' && (
        <div style={{ width: '100%', display: 'grid', gap: 10, marginTop: 6 }}>
          <form action={mainFormAction}>
            <input type="hidden" name="characterId" value={character.id} />
            <SubmitButton className="btn-sm">{t.profile.makeMain}</SubmitButton>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '6px 0 0' }}>{t.profile.makeMainHint}</p>
            <FormMessage state={mainState} />
          </form>
          <form action={retireFormAction}>
            <input type="hidden" name="characterId" value={character.id} />
            <SubmitButton variant="danger" className="btn-sm">
              {t.profile.retire}
            </SubmitButton>
            <FormMessage state={retireState} />
          </form>
        </div>
      )}

      <CharacterEditModal
        character={editing ? character : null}
        isAdmin={false}
        mode={editing ?? 'stats'}
        onClose={() => setEditing(null)}
      />
    </div>
  )
}
