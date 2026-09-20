import { LootHistory } from '@/components/vx/loot-history'
import { isGuildAdmin } from '@/lib/rules'
import { getSessionContext } from '@/lib/session'
import { requirePrimaryGuild } from '@/services/guilds'
import { listLootHistory } from '@/services/loot'

export const dynamic = 'force-dynamic'

/** "Registro de Espolios (Loot)". The live banner itself sits above the tabs. */
export default async function LootPage() {
  const session = await getSessionContext()
  const guildId = session?.actor.guildId ?? (await requirePrimaryGuild()).id
  const history = await listLootHistory(guildId)

  return (
    <LootHistory
      isAdmin={session ? isGuildAdmin(session.actor.role) : false}
      rows={history.map((row) => ({
        id: row.id,
        name: row.name,
        winnerName: row.winnerName,
        staffWon: row.staffName !== null,
        pointsPaid: row.pointsPaid,
        drawnAt: row.drawnAt?.toISOString() ?? null,
        weekNumber: row.weekNumber === null ? null : Number(row.weekNumber),
        note: row.note,
      }))}
    />
  )
}
