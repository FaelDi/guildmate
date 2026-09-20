import { AdminLedgerPanels } from '@/components/vx/admin-ledger-panels'
import { RankingTable } from '@/components/vx/ranking-table'
import { getDictionary } from '@/lib/i18n'
import { isGuildAdmin } from '@/lib/rules'
import { getSessionContext, getSettings } from '@/lib/session'
import { getGuildBoard, sortForRanking } from '@/services/board'
import { requirePrimaryGuild } from '@/services/guilds'
import { listPenalties } from '@/services/penalties'
import { listWeekExcuses } from '@/services/weeks'

export const dynamic = 'force-dynamic'

/**
 * "Modulo de Jogadores": the weekly ranking, public like the rest of the
 * board. A visitor reads the standings; the roster's own numbers (alts, level,
 * combat power) are only sent to a signed-in member.
 */
export default async function RankingPage() {
  const session = await getSessionContext()
  const guildId = session?.actor.guildId ?? (await requirePrimaryGuild()).id
  const admin = session ? isGuildAdmin(session.actor.role) : false
  const t = await getDictionary()

  const [board, settings, excuses, penalties] = await Promise.all([
    getGuildBoard(guildId),
    getSettings(guildId),
    admin && session ? listWeekExcuses(guildId) : Promise.resolve([]),
    admin && session ? listPenalties(guildId, 30) : Promise.resolve([]),
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
            mainId: r.mainId,
            userId: r.userId,
            name: r.name,
            participation: r.participation,
            penalties: r.penalties,
            balance: r.balance,
            // Withheld from the HTML itself for a visitor, not just hidden.
            details: session
              ? {
                  alts: r.alts.map((a) => a.name),
                  level: r.level,
                  combatPower: r.combatPower,
                  biosuit: r.biosuit,
                  build: r.build,
                }
              : null,
          }))}
          meId={session?.actor.id ?? null}
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
