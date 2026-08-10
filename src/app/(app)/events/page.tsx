import { Badge, Empty, Panel, Table } from '@/components/ui'
import { requireSession } from '@/lib/session'
import { listGuildEvents } from '@/services/events'

export const dynamic = 'force-dynamic'

export default async function EventsPage() {
  const { actor, now } = await requireSession()
  const events = await listGuildEvents(actor.guildId)

  return (
    <Panel
      title="Events"
      subtitle="An event confirms once it reaches its minimum registrations; otherwise it is cancelled and every point is reversed."
    >
      {events.length === 0 ? (
        <Empty>No events yet.</Empty>
      ) : (
        <Table head={['Event', 'Points', 'Status', 'Registrations', 'Code window', 'Quorum deadline']}>
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
                      open until {event.registrationClosesAt.toISOString().slice(11, 16)} UTC
                    </span>
                  ) : (
                    <span>closed</span>
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
