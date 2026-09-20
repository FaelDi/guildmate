import { MemeBoard } from '@/components/vx/meme-board'
import { isGuildAdmin } from '@/lib/rules'
import { getSessionContext } from '@/lib/session'
import { getGuildBoard } from '@/services/board'
import { requirePrimaryGuild } from '@/services/guilds'
import { listMemeDraws } from '@/services/meme'

export const dynamic = 'force-dynamic'

/** "Sorteio Items Meme". The history is public; only admins draw. */
export default async function MemePage() {
  const session = await getSessionContext()
  const guildId = session?.actor.guildId ?? (await requirePrimaryGuild()).id
  const admin = session ? isGuildAdmin(session.actor.role) : false

  const [draws, board] = await Promise.all([
    listMemeDraws(guildId),
    admin ? getGuildBoard(guildId) : Promise.resolve(null),
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
