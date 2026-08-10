import { and, eq, ne } from 'drizzle-orm'
import { db } from '@/db'
import { characters, users } from '@/db/schema'
import { CreateEventForm, EventRowActions, GrantPointsForm } from '@/components/event-admin'
import { Badge, Empty, Panel, Table } from '@/components/ui'
import { getSettings, requireAdmin } from '@/lib/session'
import { listGuildEvents, listRegistrationLog } from '@/services/events'

export const dynamic = 'force-dynamic'

export default async function AdminEventsPage() {
  const { actor, now } = await requireAdmin()
  const settings = await getSettings(actor.guildId)

  const [events, registrations, grantableCharacters] = await Promise.all([
    listGuildEvents(actor.guildId),
    listRegistrationLog(actor.guildId),
    // The admin's own characters are excluded at the query level, so the
    // self-grant rule is visible in the UI as well as enforced server-side.
    db
      .select({
        id: characters.id,
        name: characters.name,
        kind: characters.kind,
        level: characters.level,
        email: users.email,
      })
      .from(characters)
      .innerJoin(users, eq(users.id, characters.userId))
      .where(
        and(
          eq(characters.guildId, actor.guildId),
          eq(characters.isActive, true),
          ne(characters.userId, actor.id),
        ),
      )
      .orderBy(characters.name)
      .limit(500),
  ])

  const scorableEvents = events.filter((event) => event.status !== 'CANCELLED')

  return (
    <div className="space-y-6">
      <Panel
        title="Create an event"
        subtitle="The code is generated here and shown once. It expires after the lifetime you choose."
      >
        <CreateEventForm defaultTtl={settings.defaultCodeTtlMinutes} />
      </Panel>

      <Panel title="Events">
        {events.length === 0 ? (
          <Empty>No events yet.</Empty>
        ) : (
          <Table
            head={['Event', 'Points', 'Status', 'Regs', 'Code', 'Closes', 'Deadline', 'Manage']}
          >
            {events.map((event) => (
              <tr key={event.id}>
                <td className="px-3 py-2.5 font-medium text-ink">{event.name}</td>
                <td className="px-3 py-2.5 font-mono tabular-nums text-ore">
                  {event.pointsValue}
                </td>
                <td className="px-3 py-2.5">
                  <Badge value={event.status} />
                </td>
                <td className="px-3 py-2.5 font-mono text-xs tabular-nums text-muted">
                  {event.registrationCount}/{event.minParticipants}
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-muted">••••••{event.codeHint}</td>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-muted">
                  {event.registrationClosesAt.toISOString().slice(5, 16).replace('T', ' ')}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-muted">
                  {event.confirmationDeadline.toISOString().slice(5, 16).replace('T', ' ')}
                </td>
                <td className="px-3 py-2.5 align-top">
                  <EventRowActions
                    eventId={event.id}
                    currentPoints={event.pointsValue}
                    canRotate={event.status === 'OPEN'}
                  />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel
        title="Score a member manually"
        subtitle="Requires an existing event. You cannot award points to your own account or its alts."
      >
        <GrantPointsForm
          events={scorableEvents.map((e) => ({
            id: e.id,
            name: e.name,
            pointsValue: e.pointsValue,
          }))}
          characters={grantableCharacters.map((c) => ({
            id: c.id,
            label: `${c.name} — ${c.kind} lv${c.level} (${c.email})`,
          }))}
        />
      </Panel>

      <Panel
        title="Registration log"
        subtitle="Who claimed what, when, and at which level. Repeated IP fingerprints are worth a look."
      >
        {registrations.length === 0 ? (
          <Empty>No registrations yet.</Empty>
        ) : (
          <Table
            head={['When', 'Event', 'Character', 'Type', 'Lv', 'Member', 'Source', 'State', 'IP']}
          >
            {registrations.map((registration) => (
              <tr key={registration.id}>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-muted">
                  {registration.registeredAt.toISOString().slice(0, 16).replace('T', ' ')}
                </td>
                <td className="px-3 py-2.5 text-muted">{registration.eventName}</td>
                <td className="px-3 py-2.5 text-ink">{registration.characterName}</td>
                <td className="px-3 py-2.5">
                  <Badge value={registration.characterKind} />
                </td>
                <td className="px-3 py-2.5 font-mono tabular-nums text-muted">
                  {registration.levelAtRegistration}
                </td>
                <td className="px-3 py-2.5 text-xs text-muted">{registration.userEmail}</td>
                <td className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-muted">
                  {registration.source === 'ADMIN_GRANT' ? (
                    <span className="text-ore">admin</span>
                  ) : (
                    'code'
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <Badge value={registration.status} />
                </td>
                <td className="px-3 py-2.5 font-mono text-[10px] text-muted/70">
                  {registration.ipHash?.slice(0, 8) ?? '—'}
                </td>
              </tr>
            ))}
          </Table>
        )}
        <p className="mt-4 text-[11px] text-muted">
          Current time {now.toISOString().slice(0, 16).replace('T', ' ')} UTC. Quorum is{' '}
          {settings.minParticipants} registrations within {settings.confirmationWindowHours}h.
        </p>
      </Panel>
    </div>
  )
}
