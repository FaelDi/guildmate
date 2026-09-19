'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { updateCharacterAction } from '@/app/actions/characters'
import { useDictionary } from '@/components/locale-provider'
import type { BuildFlags } from '@/lib/rules'
import { CLASSES } from './format'
import { Modal } from './modal'
import { useActionRunner } from './use-action'

export type EditableCharacter = {
  id: string
  name: string
  biosuit: string
  level: number
  combatPower: number
  build: BuildFlags
}

const BUILD_KEYS: (keyof BuildFlags)[] = [
  'skill4',
  'skill5',
  'skill6',
  'skill7',
  'constant3',
  'painAdaptation',
  'trinity',
  'techniqueMaster',
]

/**
 * Edits one character. `stats` is the ranking's modal (level, combat power,
 * and the name for admins); `build` is the classes board's (class and
 * skills). Both send the whole patch, so neither can blank the other's
 * fields. Whether the caller may edit this character at all is decided on
 * the server, never here.
 */
export function CharacterEditModal({
  character,
  isAdmin,
  mode,
  onClose,
  footer,
}: {
  character: EditableCharacter | null
  isAdmin: boolean
  mode: 'stats' | 'build'
  onClose: () => void
  footer?: ReactNode
}) {
  const t = useDictionary().vx
  const { run, pending } = useActionRunner()
  const [draft, setDraft] = useState<EditableCharacter | null>(character)

  useEffect(() => setDraft(character), [character])

  if (!character || !draft) return null

  const knownClass = (CLASSES as readonly string[]).includes(draft.biosuit)

  async function save() {
    if (!draft) return
    const result = await run(
      () =>
        updateCharacterAction({
          characterId: draft.id,
          patch: {
            name: draft.name,
            biosuit: draft.biosuit,
            level: Number(draft.level) || 0,
            combatPower: Number(draft.combatPower) || 0,
            build: draft.build,
          },
        }),
      mode === 'build' ? t.buildUpdated : t.characterUpdated,
    )
    if (result.ok) onClose()
  }

  return (
    <Modal open onClose={onClose} width={480}>
      <h2>
        {mode === 'build' ? `${t.editBuildTitle} ${character.name}` : `${t.editCharacterTitle}: ${character.name}`}
      </h2>

      {mode === 'stats' ? (
        <>
          {isAdmin && (
            <>
              <label className="field-label">{t.characterName}</label>
              <input
                className="input-edit"
                value={draft.name}
                maxLength={40}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                style={{ width: '100%' }}
              />
            </>
          )}
          <label className="field-label">{t.level}</label>
          <input
            className="input-edit"
            type="number"
            min={1}
            max={999}
            value={draft.level}
            onChange={(e) => setDraft({ ...draft, level: Number(e.target.value) })}
            style={{ width: '100%' }}
          />
          <label className="field-label">{t.combatPower}</label>
          <input
            className="input-edit"
            type="number"
            min={0}
            value={draft.combatPower}
            onChange={(e) => setDraft({ ...draft, combatPower: Number(e.target.value) })}
            style={{ width: '100%' }}
          />
        </>
      ) : (
        <>
          <label className="field-label">{t.classLabel}</label>
          <select
            className="input-edit"
            value={draft.biosuit}
            onChange={(e) => setDraft({ ...draft, biosuit: e.target.value })}
            style={{ width: '100%' }}
          >
            {!knownClass && <option value={draft.biosuit}>{draft.biosuit}</option>}
            {CLASSES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <label className="field-label">{t.skillsLabel}</label>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 10,
              textAlign: 'left',
            }}
          >
            {BUILD_KEYS.map((key) => (
              <label key={key} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 17 }}>
                <input
                  type="checkbox"
                  checked={draft.build[key]}
                  onChange={(e) => setDraft({ ...draft, build: { ...draft.build, [key]: e.target.checked } })}
                  style={{ accentColor: 'var(--neon-cyan)', width: 18, height: 18 }}
                />
                {t.build[key]}
              </label>
            ))}
          </div>
        </>
      )}

      {footer && <div style={{ marginTop: 15, textAlign: 'left' }}>{footer}</div>}

      <div className="modal-actions">
        <button type="button" className="btn btn-muted" onClick={onClose}>
          {t.cancel}
        </button>
        <button type="button" className="btn btn-success" disabled={pending} onClick={save}>
          {pending ? t.processing : t.save}
        </button>
      </div>
    </Modal>
  )
}

export { BUILD_KEYS }
