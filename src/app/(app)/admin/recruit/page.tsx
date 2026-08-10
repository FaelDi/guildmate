import { headers } from 'next/headers'
import {
  IssueMemberInviteForm,
  JoinPolicyForm,
  RevokeMemberInviteButton,
} from '@/components/recruit-admin'
import { Badge, Empty, Panel, Table } from '@/components/ui'
import { getDictionary } from '@/lib/i18n'
import { describeMemberInviteStatus } from '@/lib/rules'
import { requireAdmin } from '@/lib/session'
import { getJoinPolicy, listMemberInvites } from '@/services/member-invites'

export const dynamic = 'force-dynamic'

export default async function RecruitPage() {
  const { actor, now } = await requireAdmin()
  const [invites, policy, t, headerList] = await Promise.all([
    listMemberInvites(actor),
    getJoinPolicy(actor.guildId),
    getDictionary(),
    headers(),
  ])

  const origin = `https://${headerList.get('host') ?? 'localhost:3000'}`

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <Panel
          title={t.recruit.policyTitle}
          subtitle={t.recruit.policySubtitle}
          tone={policy === 'OPEN' ? 'refined' : 'ore'}
        >
          <JoinPolicyForm current={policy} />
        </Panel>

        <Panel title={t.recruit.issueTitle} subtitle={t.recruit.issueSubtitle} tone="ore">
          <IssueMemberInviteForm origin={origin} />
        </Panel>
      </div>

      <Panel title={t.recruit.listTitle} subtitle={t.recruit.listSubtitle}>
        {invites.length === 0 ? (
          <Empty>{t.recruit.listEmpty}</Empty>
        ) : (
          <Table head={t.recruit.listHead}>
            {invites.map((invite) => {
              const status = describeMemberInviteStatus(invite, now)
              return (
                <tr key={invite.id}>
                  <td className="px-3 py-2.5 font-mono text-xs text-muted">…{invite.hint}</td>
                  <td className="px-3 py-2.5 text-muted">{invite.note ?? t.common.none}</td>
                  <td className="px-3 py-2.5">
                    <Badge value={status === 'LIVE' ? 'ACTIVE' : status} />
                  </td>
                  <td className="px-3 py-2.5 font-mono tabular-nums text-ink">
                    {invite.usedCount}/{invite.maxUses}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-muted">
                    {invite.expiresAt.toISOString().slice(0, 16).replace('T', ' ')}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted">
                    {invite.issuedByEmail ?? t.common.none}
                  </td>
                  <td className="px-3 py-2.5">
                    {status === 'LIVE' && <RevokeMemberInviteButton inviteId={invite.id} />}
                  </td>
                </tr>
              )
            })}
          </Table>
        )}
      </Panel>
    </div>
  )
}
