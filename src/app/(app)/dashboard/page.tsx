import Link from 'next/link'
import { desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { events, pointLedger } from '@/db/schema'
import { RedeemCodeForm } from '@/components/redeem-code-form'
import { Badge, Empty, Panel, Stat, Table } from '@/components/ui'
import { getDictionary } from '@/lib/i18n'
import { requireSession } from '@/lib/session'
import { listOwnCharacters } from '@/services/accounts'
import { getBalance } from '@/services/points'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const { actor } = await requireSession()
  const t = await getDictionary()

  const [balance, characters, ledger] = await Promise.all([
    getBalance(actor.id),
    listOwnCharacters(actor.id),
    db
      .select({
        id: pointLedger.id,
        kind: pointLedger.kind,
        state: pointLedger.state,
        amount: pointLedger.amount,
        reason: pointLedger.reason,
        createdAt: pointLedger.createdAt,
        eventName: events.name,
      })
      .from(pointLedger)
      .leftJoin(events, eq(events.id, pointLedger.eventId))
      .where(eq(pointLedger.userId, actor.id))
      .orderBy(desc(pointLedger.createdAt))
      .limit(30),
  ])

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label={t.dashboard.spendable}
          value={balance.available}
          tone="refined"
          hint={t.dashboard.spendableHint}
        />
        <Stat
          label={t.dashboard.pending}
          value={balance.pending}
          tone="ore"
          hint={t.dashboard.pendingHint}
        />
        <Stat label={t.common.characters} value={characters.length} />
      </div>

      <Panel
        title={t.dashboard.redeemTitle}
        subtitle={t.dashboard.redeemSubtitle}
      >
        <RedeemCodeForm
          characters={characters.map((c) => ({
            id: c.id,
            name: c.name,
            kind: c.kind,
            level: c.level,
          }))}
        />
      </Panel>

      <Panel
        title={t.dashboard.charactersTitle}
        action={
          <Link href="/profile" className="text-xs text-ore hover:underline">
            {t.dashboard.manageRoster}
          </Link>
        }
      >
        {characters.length === 0 ? (
          <Empty>{t.dashboard.noCharacters}</Empty>
        ) : (
          <Table head={t.dashboard.charactersHead}>
            {characters.map((character) => (
              <tr key={character.id}>
                <td className="px-3 py-2.5 font-medium text-ink">{character.name}</td>
                <td className="px-3 py-2.5">
                  <Badge value={character.kind} />
                </td>
                <td className="px-3 py-2.5">
                  <Badge value={character.race} />
                </td>
                <td className="px-3 py-2.5 text-muted">{character.biosuit}</td>
                <td className="px-3 py-2.5 font-mono tabular-nums text-muted">{character.level}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel title={t.dashboard.ledgerTitle} subtitle={t.dashboard.ledgerSubtitle}>
        {ledger.length === 0 ? (
          <Empty>{t.dashboard.ledgerEmpty}</Empty>
        ) : (
          <Table head={t.dashboard.ledgerHead}>
            {ledger.map((entry) => (
              <tr key={entry.id}>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-muted">
                  {entry.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                </td>
                <td
                  className={`px-3 py-2.5 font-mono tabular-nums ${
                    entry.amount < 0 ? 'text-slag' : 'text-refined'
                  }`}
                >
                  {entry.amount > 0 ? '+' : ''}
                  {entry.amount}
                </td>
                <td className="px-3 py-2.5">
                  <Badge value={entry.state} />
                </td>
                <td className="px-3 py-2.5 text-muted">{entry.reason}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </div>
  )
}
