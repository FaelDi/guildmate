import { MemberActions } from '@/components/member-actions'
import { Badge, Empty, Panel, Stat, Table } from '@/components/ui'
import { getDictionary } from '@/lib/i18n'
import { requireAdmin } from '@/lib/session'
import { listActiveRestrictions, listMembers } from '@/services/moderation'

export const dynamic = 'force-dynamic'

export default async function AdminMembersPage() {
  const { actor } = await requireAdmin()
  const t = await getDictionary()
  const [members, restrictions] = await Promise.all([
    listMembers(actor),
    listActiveRestrictions(actor),
  ])

  const active = members.filter((m) => m.status === 'ACTIVE').length
  const banned = members.filter((m) => m.status === 'BANNED').length

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label={t.admin.membersStat} value={members.length} />
        <Stat label={t.admin.activeStat} value={active} tone="refined" />
        <Stat label={t.admin.restrictedStat} value={banned} tone="ore" />
        <Stat label={t.admin.liveRestrictionsStat} value={restrictions.length} />
      </div>

      <Panel
        title={t.admin.rosterTitle}
        subtitle={t.admin.rosterSubtitle}
      >
        {members.length === 0 ? (
          <Empty>{t.admin.rosterEmpty}</Empty>
        ) : (
          <Table
            head={t.admin.rosterHead}
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
                  <span className="text-ore">{member.availablePoints}</span>
                  <span className="text-muted"> / </span>
                  <span className="text-ore">{member.pendingPoints}</span>
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

      <Panel title={t.admin.restrictionsTitle}>
        {restrictions.length === 0 ? (
          <Empty>{t.admin.restrictionsEmpty}</Empty>
        ) : (
          <Table head={t.admin.restrictionsHead}>
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
                    <span className="text-slag">permanent</span>
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
