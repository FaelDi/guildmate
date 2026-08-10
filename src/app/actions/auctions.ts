'use server'

import { revalidatePath } from 'next/cache'
import { runAction, type ActionResult } from '@/lib/errors'
import { getSettings, requireAdmin, requireSession } from '@/lib/session'
import { cancelAuction, createAuction, placeBid } from '@/services/auctions'

export async function placeBidAction(
  _previous: ActionResult<{ amount: number }> | null,
  formData: FormData,
): Promise<ActionResult<{ amount: number }>> {
  const result = await runAction(async () => {
    const { actor, now } = await requireSession()
    const { amount } = await placeBid({
      actor,
      auctionId: String(formData.get('auctionId') ?? ''),
      characterId: String(formData.get('characterId') ?? ''),
      amount: Number(formData.get('amount') ?? 0),
      settings: await getSettings(actor.guildId),
      now,
    })
    return { amount }
  })

  if (result.ok) {
    revalidatePath('/auctions')
    revalidatePath('/dashboard')
  }
  return result
}

export async function createAuctionAction(
  _previous: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const result = await runAction(async () => {
    const { actor, now } = await requireAdmin()
    return createAuction({
      actor,
      input: {
        itemName: String(formData.get('itemName') ?? ''),
        description: String(formData.get('description') ?? '') || undefined,
        itemType: String(formData.get('itemType') ?? 'OTHER') as 'OTHER',
        rarity: String(formData.get('rarity') ?? 'RARE') as 'RARE',
        itemLevel: Number(formData.get('itemLevel') ?? 1),
        startingBid: Number(formData.get('startingBid') ?? 1),
        minIncrement: Number(formData.get('minIncrement') ?? 1),
        durationMinutes: Number(formData.get('durationMinutes') ?? 1440),
      },
      now,
    })
  })

  if (result.ok) revalidatePath('/auctions')
  return result
}

export async function cancelAuctionAction(
  _previous: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    const { actor, now } = await requireAdmin()
    await cancelAuction({
      actor,
      auctionId: String(formData.get('auctionId') ?? ''),
      reason: String(formData.get('reason') ?? ''),
      now,
    })
    return null
  })

  if (result.ok) {
    revalidatePath('/auctions')
    revalidatePath('/dashboard')
  }
  return result
}
