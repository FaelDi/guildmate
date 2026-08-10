import { ListingForm } from '@/components/listing-form'
import { Badge, Empty, Panel, Table } from '@/components/ui'
import { getDictionary } from '@/lib/i18n'
import { requireSession } from '@/lib/session'
import { listOwnCharacters } from '@/services/accounts'
import { listMarket } from '@/services/market'

export const dynamic = 'force-dynamic'

export default async function MarketPage() {
  const { actor } = await requireSession()
  const t = await getDictionary()
  const [listings, characters] = await Promise.all([
    listMarket(actor.guildId),
    listOwnCharacters(actor.id),
  ])

  return (
    <div className="space-y-6">
      <Panel
        title={t.market.title}
        subtitle={t.market.subtitle}
      >
        {listings.length === 0 ? (
          <Empty>{t.market.empty}</Empty>
        ) : (
          <Table head={t.market.head}>
            {listings.map((listing) => (
              <tr key={listing.id}>
                <td className="px-3 py-2.5">
                  <div className="font-medium text-ink">{listing.itemName}</div>
                  {listing.notes && (
                    <div className="mt-0.5 max-w-sm text-xs text-muted">{listing.notes}</div>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <Badge value={listing.rarity} />
                </td>
                <td className="px-3 py-2.5 text-xs text-muted">
                  {listing.itemType.charAt(0) + listing.itemType.slice(1).toLowerCase()}
                </td>
                <td className="px-3 py-2.5 font-mono tabular-nums text-muted">
                  {listing.itemLevel}
                </td>
                <td className="px-3 py-2.5 font-mono tabular-nums text-muted">
                  {listing.quantity}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono tabular-nums text-ore">
                  {listing.priceDiamonds.toLocaleString('en-US')} 💎
                </td>
                <td className="px-3 py-2.5 text-xs text-muted">
                  {listing.sellerCharacterName}
                  {listing.sellerUserId === actor.id && (
                    <span className="ml-1.5 text-[10px] uppercase tracking-wider text-ore">
                      {t.common.you}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel title={t.market.listTitle} subtitle={t.market.listSubtitle}>
        <ListingForm
          characters={characters.map((c) => ({
            id: c.id,
            name: c.name,
            kind: c.kind,
            level: c.level,
          }))}
        />
      </Panel>
    </div>
  )
}
