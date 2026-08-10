import { MemberActions } from '@/components/member-actions'
import { Badge, Empty, Panel, Stat, Table } from '@/components/ui'
import { requireAdmin } from '@/lib/session'
import { listActiveRestrictions, listMembers } from '@/services/moderation'

export const dynamic = 'force-dynamic'

export default async function AdminMembersPage() {
  const { actor } = await requireAdmin()
  const [members, restrictions] = await Promise.all([
    listMembers(actor),
    listActiveRestrictions(actor),
  ])

  const active = members.filter((m) => m.status === 'ACTIVE').length
  const banned = members.filter((m) => m.status === 'BANNED').length

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Members" value={members.length} />
        <Stat label="Active" value={active} tone="toxic" />
        <Stat label="Restricted" value={banned} tone="ember" />
        <Stat label="Live restrictions" value={restrictions.length} />
      </div>

      <Panel
        title="Roster"
        subtitle="Levels, points and registration counts. You can only moderate members below your own rank."
      >
        {members.length === 0 ? (
          <Empty>No members yet.</Empty>
        ) : (
          <Table
            head={['Member', 'Main character', 'Lv', 'Role', 'Status', 'Events', 'Points', 'Manage']}
          >
            {members.map((member) => (
              <tr key={member.id}>
                <td className="px-3 py-2.5">
                  <div className="text-ink">{member.email}</div>
                  <div className="text-[11px] text-muted">
                    {member.characterCount} character{member.characterCount === 1 ? '' : 's'}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-muted">{member.mainCharacterName ?? '—'}</td>
                <td className="px-3 py-2.5 font-mono tabular-nums text-muted">
                  {member.mainCharacterLevel ?? '—'}
                </td>
                <td className="px-3 py-2.5">
                  <Badge value={member.role} />
                </td>
                <td className="px-3 py-2.5">
                  <Badge value={member.status} />
                </td>
                <td className="px-3 py-2.5 font-mono tabular-nums text-muted">
                  {member.registrationCount}
                </td>
                <td className="px-3 py-2.5 font-mono text-xs tabular-nums">
                  <span className="text-plasma">{member.availablePoints}</span>
                  <span className="text-muted"> / </span>
                  <span className="text-ember">{member.pendingPoints}</span>
                </td>
                <td className="px-3 py-2.5 align-top">
                  <MemberActions
                    member={{
                      id: member.id,
                      email: member.email,
                      role: member.role,
                      isActive: member.isActive,
                      deletedAt: member.deletedAt,
                    }}
                  />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel title="Active restrictions">
        {restrictions.length === 0 ? (
          <Empty>No restrictions in force.</Empty>
        ) : (
          <Table head={['Member', 'Type', 'Reason', 'Since', 'Until']}>
            {restrictions.map((restriction) => (
              <tr key={restriction.id}>
                <td className="px-3 py-2.5 text-ink">{restriction.email}</td>
                <td className="px-3 py-2.5">
                  <Badge value={restriction.type} />
                </td>
                <td className="px-3 py-2.5 text-muted">{restriction.reason}</td>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-muted">
                  {restriction.startsAt.toISOString().slice(0, 10)}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-muted">
                  {restriction.expiresAt ? (
                    restriction.expiresAt.toISOString().slice(0, 10)
                  ) : (
                    <span className="text-blood">permanent</span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </div>
  )
}
