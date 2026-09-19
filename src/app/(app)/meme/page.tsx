import { MemeBoard } from '@/components/vx/meme-board'
import { isGuildAdmin } from '@/lib/rules'
import { requireSession } from '@/lib/session'
import { getGuildBoard } from '@/services/board'
import { listMemeDraws } from '@/services/meme'

export const dynamic = 'force-dynamic'

/** "Sorteio Items Meme". */
export default async function MemePage() {
  const { actor } = await requireSession()
  const admin = isGuildAdmin(actor.role)

  const [draws, board] = await Promise.all([
    listMemeDraws(actor.guildId),
    admin ? getGuildBoard(actor.guildId) : Promise.resolve(null),
  ])

  return (
    <MemeBoard
      isAdmin={admin}
      rows={draws.map((d) => ({
        id: d.id,
        itemName: d.itemName,
        winnerName: d.winnerName,
        note: d.note,
        createdAt: d.createdAt.toISOString(),
      }))}
      candidates={(board?.rows ?? [])
        .map((r) => ({ id: r.mainId, name: r.name }))
        .sort((a, b) => a.name.localeCompare(b.name))}
    />
  )
}
