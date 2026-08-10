'use server'

import { revalidatePath } from 'next/cache'
import { runAction, type ActionResult } from '@/lib/errors'
import { requireSession } from '@/lib/session'
import {
  createCharacter,
  retireCharacter,
  setMainCharacter,
  updateCharacter,
  type CharacterDraftDto,
  type CharacterPatchDto,
} from '@/services/characters'

/**
 * Roster management. Every id here arrives in a FormData and is therefore
 * attacker-controlled: the service re-authorizes it against the loaded row, and
 * no action below trusts anything the form claims about ownership.
 */

function revalidateRoster(): void {
  revalidatePath('/profile')
  revalidatePath('/dashboard')
}

function readDraft(formData: FormData): CharacterDraftDto {
  return {
    name: String(formData.get('characterName') ?? ''),
    race: String(formData.get('race') ?? 'BELLATO') as CharacterDraftDto['race'],
    biosuit: String(formData.get('biosuit') ?? ''),
    // `|| 0` rather than a default: a non-numeric level must reach the rule and
    // come back as INVALID_LEVEL, not as a NaN the schema rejects generically.
    level: Number(formData.get('level')) || 0,
    kind: formData.get('kind') === 'ALT' ? 'ALT' : 'MAIN',
  }
}

function readPatch(formData: FormData): CharacterPatchDto {
  return {
    name: String(formData.get('characterName') ?? ''),
    biosuit: String(formData.get('biosuit') ?? ''),
    // `|| 0` rather than a default: a non-numeric level must reach the rule and
    // come back as INVALID_LEVEL, not as a NaN the schema rejects generically.
    level: Number(formData.get('level')) || 0,
  }
}

export async function createCharacterAction(
  _previous: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const result = await runAction(async () => {
    const { actor, restrictions, now } = await requireSession()
    return createCharacter({ actor, restrictions, input: readDraft(formData), now })
  })

  if (result.ok) revalidateRoster()
  return result
}

export async function updateCharacterAction(
  _previous: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    const { actor, restrictions, now } = await requireSession()
    await updateCharacter({
      actor,
      restrictions,
      characterId: String(formData.get('characterId') ?? ''),
      patch: readPatch(formData),
      now,
    })
    return null
  })

  if (result.ok) revalidateRoster()
  return result
}

export async function setMainCharacterAction(
  _previous: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    const { actor, restrictions, now } = await requireSession()
    await setMainCharacter({
      actor,
      restrictions,
      characterId: String(formData.get('characterId') ?? ''),
      now,
    })
    return null
  })

  if (result.ok) revalidateRoster()
  return result
}

export async function retireCharacterAction(
  _previous: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    const { actor, restrictions, now } = await requireSession()
    await retireCharacter({
      actor,
      restrictions,
      characterId: String(formData.get('characterId') ?? ''),
      now,
    })
    return null
  })

  if (result.ok) revalidateRoster()
  return result
}
