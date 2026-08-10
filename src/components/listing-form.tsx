'use client'

import { useActionState } from 'react'
import { createListingAction } from '@/app/actions/market'
import { FormMessage, SubmitButton } from '@/components/form'
import { Field, Input, Select, Textarea } from '@/components/ui'
import type { CharacterOption } from './redeem-code-form'

const ITEM_TYPES = [
  'WEAPON', 'ARMOR', 'SHIELD', 'HELMET', 'GLOVES', 'BOOTS',
  'ACCESSORY', 'BIOSUIT', 'MATERIAL', 'CONSUMABLE', 'OTHER',
] as const

const RARITIES = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'] as const

export function ListingForm({ characters }: { characters: CharacterOption[] }) {
  const [state, formAction] = useActionState(createListingAction, null)

  if (characters.length === 0) {
    return <p className="text-sm text-muted">Create a character before listing items.</p>
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Selling character">
          <Select name="characterId" required>
            {characters.map((character) => (
              <option key={character.id} value={character.id}>
                {character.name} — {character.kind}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Item name">
          <Input name="itemName" required minLength={2} maxLength={120} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Type">
          <Select name="itemType" defaultValue="WEAPON">
            {ITEM_TYPES.map((type) => (
              <option key={type} value={type}>
                {type.charAt(0) + type.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Rarity">
          <Select name="rarity" defaultValue="RARE">
            {RARITIES.map((rarity) => (
              <option key={rarity} value={rarity}>
                {rarity.charAt(0) + rarity.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Item level">
          <Input name="itemLevel" type="number" min={1} max={999} defaultValue={1} required />
        </Field>

        <Field label="Quantity">
          <Input name="quantity" type="number" min={1} max={9999} defaultValue={1} required />
        </Field>
      </div>

      <Field label="Price (diamonds)">
        <Input
          name="priceDiamonds"
          type="number"
          min={1}
          required
          className="font-mono tabular-nums"
        />
      </Field>

      <Field label="Notes">
        <Textarea name="notes" maxLength={500} placeholder="Stats, upgrades, where to meet..." />
      </Field>

      <FormMessage state={state} success={state?.ok ? 'Listing published.' : null} />

      <SubmitButton>Publish listing</SubmitButton>
    </form>
  )
}
