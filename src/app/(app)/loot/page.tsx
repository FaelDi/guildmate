import { LootHistory } from '@/components/vx/loot-history'
import { isGuildAdmin } from '@/lib/rules'
import { requireSession } from '@/lib/session'
import { listLootHistory } from '@/services/loot'

export const dynamic = 'force-dynamic'

/** "Registro de Espolios (Loot)". The live banner itself sits above the tabs. */
export default async function LootPage() {
  const { actor } = await requireSession()
  const history = await listLootHistory(actor.guildId)

  return (
    <LootHistory
      isAdmin={isGuildAdmin(actor.role)}
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
