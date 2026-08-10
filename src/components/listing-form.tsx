'use client'

import { useActionState } from 'react'
import { createListingAction } from '@/app/actions/market'
import { FormMessage, SubmitButton } from '@/components/form'
import { useDictionary } from '@/components/locale-provider'
import { Field, Input, Select, Textarea } from '@/components/ui'
import type { CharacterOption } from './redeem-code-form'

const ITEM_TYPES = [
  'WEAPON', 'ARMOR', 'SHIELD', 'HELMET', 'GLOVES', 'BOOTS',
  'ACCESSORY', 'BIOSUIT', 'MATERIAL', 'CONSUMABLE', 'OTHER',
] as const

const RARITIES = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'] as const

export function ListingForm({ characters }: { characters: CharacterOption[] }) {
  const [state, formAction] = useActionState(createListingAction, null)
  const t = useDictionary()

  if (characters.length === 0) {
    return <p className="text-sm text-muted">{t.market.needCharacter}</p>
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.market.sellingCharacter}>
          <Select name="characterId" required>
            {characters.map((character) => (
              <option key={character.id} value={character.id}>
                {character.name} — {character.kind}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t.market.itemName}>
          <Input name="itemName" required minLength={2} maxLength={120} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Field label={t.market.type}>
          <Select name="itemType" defaultValue="WEAPON">
            {ITEM_TYPES.map((type) => (
              <option key={type} value={type}>
                {type.charAt(0) + type.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t.market.rarity}>
          <Select name="rarity" defaultValue="RARE">
            {RARITIES.map((rarity) => (
              <option key={rarity} value={rarity}>
                {rarity.charAt(0) + rarity.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t.market.itemLevel}>
          <Input name="itemLevel" type="number" min={1} max={999} defaultValue={1} required />
        </Field>

        <Field label={t.market.quantity}>
          <Input name="quantity" type="number" min={1} max={9999} defaultValue={1} required />
        </Field>
      </div>

      <Field label={t.market.price}>
        <Input
          name="priceDiamonds"
          type="number"
          min={1}
          required
          className="font-mono tabular-nums"
        />
      </Field>

      <Field label={t.market.notes}>
        <Textarea name="notes" maxLength={500} placeholder={t.market.notesPlaceholder} />
      </Field>

      <FormMessage state={state} success={state?.ok ? t.market.published : null} />

      <SubmitButton>{t.market.publish}</SubmitButton>
    </form>
  )
}
