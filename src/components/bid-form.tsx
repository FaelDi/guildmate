'use client'

import { useActionState } from 'react'
import { placeBidAction } from '@/app/actions/auctions'
import { FormMessage, SubmitButton } from '@/components/form'
import { Input, Select } from '@/components/ui'
import type { CharacterOption } from './redeem-code-form'

/**
 * Only main characters appear in the picker, mirroring the server rule. The
 * server still enforces it - this is convenience, not the control.
 */
export function BidForm({
  auctionId,
  minimum,
  mainCharacters,
}: {
  auctionId: string
  minimum: number
  mainCharacters: CharacterOption[]
}) {
  const [state, formAction] = useActionState(placeBidAction, null)

  if (mainCharacters.length === 0) {
    return (
      <p className="text-xs text-muted">
        Only a main character can bid. Set one on your profile first.
      </p>
    )
  }

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="auctionId" value={auctionId} />
      <div className="flex flex-wrap items-center gap-2">
        <Select name="characterId" required className="w-auto min-w-36">
          {mainCharacters.map((character) => (
            <option key={character.id} value={character.id}>
              {character.name}
            </option>
          ))}
        </Select>
        <Input
          name="amount"
          type="number"
          min={minimum}
          defaultValue={minimum}
          required
          className="w-32 font-mono tabular-nums"
        />
        <SubmitButton>Bid</SubmitButton>
      </div>
      <FormMessage
        state={state}
        success={state?.ok ? `Bid of ${state.data.amount} points placed.` : null}
      />
    </form>
  )
}
