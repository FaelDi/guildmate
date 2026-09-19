import { AdminLedgerPanels } from '@/components/vx/admin-ledger-panels'
import { RankingTable } from '@/components/vx/ranking-table'
import { getDictionary } from '@/lib/i18n'
import { isGuildAdmin } from '@/lib/rules'
import { getSettings, requireSession } from '@/lib/session'
import { getGuildBoard, sortForRanking } from '@/services/board'
import { listPenalties } from '@/services/penalties'
import { listWeekExcuses } from '@/services/weeks'

export const dynamic = 'force-dynamic'

/** "Modulo de Jogadores": the weekly ranking. */
export default async function RankingPage() {
  const { actor } = await requireSession()
  const admin = isGuildAdmin(actor.role)
  const t = await getDictionary()

  const [board, settings, excuses, penalties] = await Promise.all([
    getGuildBoard(actor.guildId),
    getSettings(actor.guildId),
    admin ? listWeekExcuses(actor.guildId) : Promise.resolve([]),
    admin ? listPenalties(actor.guildId, 30) : Promise.resolve([]),
  ])

  const rows = sortForRanking(board.rows)
  const nameByUser = new Map(board.rows.map((r) => [r.userId, r.name]))

  return (
    <>
      <div className="table-container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0 }}>{t.vx.rankingTitle}</h2>
        </div>
        <RankingTable
          rows={rows.map((r) => ({
            id: r.mainId,
            userId: r.userId,
            name: r.name,
            biosuit: r.biosuit,
            level: r.level,
            combatPower: r.combatPower,
            build: r.build,
            alts: r.alts.map((a) => a.name),
            participation: r.participation,
            penalties: r.penalties,
            balance: r.balance,
          }))}
          meId={actor.id}
          isAdmin={admin}
          thresholds={settings}
        />
      </div>

      {admin && (
        <AdminLedgerPanels
          excuses={excuses.map((e) => ({
            id: e.id,
            name: nameByUser.get(e.userId) ?? '—',
            eventsExcused: e.eventsExcused,
            reason: e.reason,
            createdAt: e.createdAt.toISOString(),
          }))}
          penalties={penalties.map((p) => ({
            id: p.id,
            name: nameByUser.get(p.userId) ?? '—',
            amount: p.amount,
            reason: p.reason,
            createdAt: p.createdAt.toISOString(),
            reversed: Boolean(p.reversed),
          }))}
        />
      )}
    </>
  )
}
