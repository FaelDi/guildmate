import { Badge, Empty, Panel, Table } from '@/components/ui'
import { getDictionary } from '@/lib/i18n'
import { requireSession } from '@/lib/session'
import { listGuildEvents } from '@/services/events'

export const dynamic = 'force-dynamic'

export default async function EventsPage() {
  const { actor, now } = await requireSession()
  const events = await listGuildEvents(actor.guildId)
  const t = await getDictionary()

  return (
    <Panel
      title={t.events.title}
      subtitle={t.events.subtitle}
    >
      {events.length === 0 ? (
        <Empty>{t.events.empty}</Empty>
      ) : (
        <Table head={t.events.head}>
          {events.map((event) => {
            const codeOpen = event.status === 'OPEN' && event.registrationClosesAt > now
            return (
              <tr key={event.id}>
                <td className="px-3 py-2.5">
                  <div className="font-medium text-ink">{event.name}</div>
                  {event.description && (
                    <div className="mt-0.5 max-w-md text-xs text-muted">{event.description}</div>
                  )}
                </td>
                <td className="px-3 py-2.5 font-mono tabular-nums text-ore">
                  {event.pointsValue}
                </td>
                <td className="px-3 py-2.5">
                  <Badge value={event.status} />
                </td>
                <td className="px-3 py-2.5 font-mono text-xs tabular-nums text-muted">
                  {event.registrationCount}/{event.minParticipants}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted">
                  {codeOpen ? (
                    <span className="text-refined">
                      {t.events.openUntil} {event.registrationClosesAt.toISOString().slice(11, 16)} UTC
                    </span>
                  ) : (
                    <span>{t.events.closed}</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-muted">
                  {event.confirmationDeadline.toISOString().slice(0, 16).replace('T', ' ')}
                </td>
              </tr>
            )
          })}
        </Table>
      )}
    </Panel>
  )
}
