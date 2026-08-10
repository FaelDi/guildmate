import { BidForm } from '@/components/bid-form'
import { Badge, Empty, Panel, Stat } from '@/components/ui'
import { requireSession } from '@/lib/session'
import { listOwnCharacters } from '@/services/accounts'
import { listAuctions } from '@/services/auctions'
import { getBalance } from '@/services/points'

export const dynamic = 'force-dynamic'

export default async function AuctionsPage() {
  const { actor, now } = await requireSession()
  const [auctions, characters, balance] = await Promise.all([
    listAuctions(actor.guildId),
    listOwnCharacters(actor.id),
    getBalance(actor.id),
  ])

  const mainCharacters = characters
    .filter((c) => c.kind === 'MAIN')
    .map((c) => ({ id: c.id, name: c.name, kind: c.kind, level: c.level }))

  const open = auctions.filter((a) => a.status === 'OPEN' && a.endsAt > now)
  const closed = auctions.filter((a) => !(a.status === 'OPEN' && a.endsAt > now))

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Stat
          label="Spendable points"
          value={balance.available}
          tone="plasma"
          hint="Bids you are winning are already deducted."
        />
        <Stat label="Open auctions" value={open.length} />
      </div>

      <Panel
        title="Open auctions"
        subtitle="Paid with confirmed event points. A bid inside the closing window extends the clock."
      >
        {open.length === 0 ? (
          <Empty>No auctions are running.</Empty>
        ) : (
          <ul className="space-y-4">
            {open.map((auction) => (
              <li
                key={auction.id}
                className="rounded-md border border-edge bg-panel-raised/50 px-4 py-3.5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-ink">{auction.itemName}</span>
                      <Badge value={auction.rarity} />
                      <span className="font-mono text-[10px] text-muted">
                        lv{auction.itemLevel}
                      </span>
                    </div>
                    {auction.description && (
                      <p className="mt-1 max-w-lg text-xs text-muted">{auction.description}</p>
                    )}
                    <p className="mt-1.5 text-[11px] text-muted">
                      Ends {auction.endsAt.toISOString().slice(0, 16).replace('T', ' ')} UTC
                      {auction.currentBidderUserId === actor.id && (
                        <span className="ml-2 text-toxic">you are winning</span>
                      )}
                    </p>
                  </div>

                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-muted">
                      {auction.currentBid === null ? 'Starting bid' : 'Current bid'}
                    </div>
                    <div className="font-mono text-xl tabular-nums text-plasma">
                      {auction.currentBid ?? auction.startingBid}
                    </div>
                    <div className="text-[10px] text-muted">
                      next: {auction.nextMinimumBid}
                    </div>
                  </div>
                </div>

                <div className="mt-3 border-t border-edge pt-3">
                  <BidForm
                    auctionId={auction.id}
                    minimum={auction.nextMinimumBid}
                    mainCharacters={mainCharacters}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {closed.length > 0 && (
        <Panel title="Settled">
          <ul className="space-y-2">
            {closed.map((auction) => (
              <li
                key={auction.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-edge px-4 py-2.5 text-sm"
              >
                <span className="text-muted">{auction.itemName}</span>
                <span className="flex items-center gap-3">
                  <Badge value={auction.status} />
                  <span className="font-mono tabular-nums text-muted">
                    {auction.currentBid ?? 0} pts
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  )
}
