'use server'

import { revalidatePath } from 'next/cache'
import { runAction, type ActionResult } from '@/lib/errors'
import { requireSession } from '@/lib/session'
import { closeListing, createListing, updateListing, type ListingInputDto } from '@/services/market'

function readListingInput(formData: FormData): ListingInputDto {
  return {
    itemName: String(formData.get('itemName') ?? ''),
    itemType: String(formData.get('itemType') ?? 'OTHER') as ListingInputDto['itemType'],
    rarity: String(formData.get('rarity') ?? 'COMMON') as ListingInputDto['rarity'],
    itemLevel: Number(formData.get('itemLevel') ?? 1),
    priceDiamonds: Number(formData.get('priceDiamonds') ?? 1),
    quantity: Number(formData.get('quantity') ?? 1),
    notes: String(formData.get('notes') ?? '') || undefined,
  }
}

export async function createListingAction(
  _previous: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const result = await runAction(async () => {
    const { actor, restrictions, now } = await requireSession()
    return createListing({
      actor,
      restrictions,
      characterId: String(formData.get('characterId') ?? ''),
      input: readListingInput(formData),
      now,
    })
  })

  if (result.ok) revalidatePath('/market')
  return result
}

export async function updateListingAction(
  _previous: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    const { actor, now } = await requireSession()
    // Ownership is enforced inside the service, not here: the check belongs
    // next to the loaded row.
    await updateListing({
      actor,
      listingId: String(formData.get('listingId') ?? ''),
      patch: readListingInput(formData),
      now,
    })
    return null
  })

  if (result.ok) revalidatePath('/market')
  return result
}

export async function closeListingAction(
  _previous: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    const { actor, now } = await requireSession()
    await closeListing({
      actor,
      listingId: String(formData.get('listingId') ?? ''),
      status: formData.get('status') === 'SOLD' ? 'SOLD' : 'CANCELLED',
      now,
    })
    return null
  })

  if (result.ok) revalidatePath('/market')
  return result
}
