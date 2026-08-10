import Link from 'next/link'
import { desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { events, pointLedger } from '@/db/schema'
import { RedeemCodeForm } from '@/components/redeem-code-form'
import { Badge, Empty, Panel, Stat, Table } from '@/components/ui'
import { requireSession } from '@/lib/session'
import { listOwnCharacters } from '@/services/accounts'
import { getBalance } from '@/services/points'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const { actor } = await requireSession()

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
          label="Spendable points"
          value={balance.available}
          tone="refined"
          hint="Usable in auctions. Active bids are already deducted."
        />
        <Stat
          label="Pending points"
          value={balance.pending}
          tone="ore"
          hint="Waiting on their event to reach quorum."
        />
        <Stat label="Characters" value={characters.length} />
      </div>

      <Panel
        title="Register for a live event"
        subtitle="Enter the code an admin announced. It only works inside the window they set."
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
        title="Your characters"
        action={
          <Link href="/profile" className="text-xs text-ore hover:underline">
            Manage roster
          </Link>
        }
      >
        {characters.length === 0 ? (
          <Empty>No characters yet.</Empty>
        ) : (
          <Table head={['Name', 'Type', 'Race', 'Biosuit', 'Level']}>
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

      <Panel title="Point ledger" subtitle="Every entry that ever affected your balance.">
        {ledger.length === 0 ? (
          <Empty>No point activity yet.</Empty>
        ) : (
          <Table head={['When', 'Amount', 'State', 'Reason']}>
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
