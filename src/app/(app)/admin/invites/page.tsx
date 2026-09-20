import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { IssueInviteForm, RevokeInviteButton } from '@/components/invite-admin'
import { CreateGuildPanel } from '@/components/vx/create-guild-panel'
import { Badge, Empty, Panel, Table } from '@/components/ui'
import { describeInviteStatus } from '@/lib/rules'
import { getDictionary } from '@/lib/i18n'
import { requireSessionPage } from '@/lib/session'
import { getPrimaryGuild, listGuilds } from '@/services/guilds'
import { listInvites } from '@/services/invites'

export const dynamic = 'force-dynamic'

function stamp(value: Date | null): string {
  return value ? value.toISOString().slice(0, 16).replace('T', ' ') : '—'
}

export default async function InvitesPage() {
  const { actor, now } = await requireSessionPage()
  // Not a redirect: a member has no business learning that this screen exists.
  if (actor.role !== 'SUPER_ADMIN') notFound()

  const [invites, allGuilds, primary] = await Promise.all([
    listInvites(actor),
    listGuilds(),
    getPrimaryGuild(),
  ])
  const t = await getDictionary()
  const headerList = await headers()
  const origin = `https://${headerList.get('host') ?? 'localhost:3000'}`

  return (
    <div className="space-y-6">
      <CreateGuildPanel origin={origin} />

      <Panel title={t.vx.guildsTitle} subtitle={t.vx.guildsHint}>
        <Table head={t.vx.guildsHead}>
          {allGuilds.map((guild) => (
            <tr key={guild.id}>
              <td style={{ color: '#fff', fontWeight: 700 }}>
                {guild.name}
                {guild.tag && <span style={{ color: 'var(--text-muted)' }}> [{guild.tag}]</span>}
              </td>
              <td style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{guild.slug}</td>
              <td>
                {guild.id === primary?.id ? (
                  <Badge value="PRIMARY">{t.vx.primaryGuild}</Badge>
                ) : (
                  <Badge value={guild.isActive ? 'ACTIVE' : 'INACTIVE'} />
                )}
              </td>
              <td style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 14 }}>
                {stamp(guild.createdAt)}
              </td>
            </tr>
          ))}
        </Table>
      </Panel>

      <Panel
        title={t.invite.adminIssueTitle}
        subtitle={t.invite.adminIssueSubtitle}
        tone="ore"
      >
        <IssueInviteForm origin={origin} />
      </Panel>

      <Panel title={t.invite.listTitle} subtitle={t.invite.listSubtitle}>
        {invites.length === 0 ? (
          <Empty>{t.invite.listEmpty}</Empty>
        ) : (
          <Table head={t.invite.listHead}>
            {invites.map((invite) => {
              const status = describeInviteStatus(invite, now)
              return (
                <tr key={invite.id}>
                  <td className="px-3 py-2.5 font-mono text-xs text-muted">…{invite.hint}</td>
                  <td className="px-3 py-2.5 text-muted">{invite.note ?? '—'}</td>
                  <td className="px-3 py-2.5">
                    <Badge value={status === 'LIVE' ? 'ACTIVE' : status} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-muted">
                    {stamp(invite.expiresAt)}
                  </td>
                  <td className="px-3 py-2.5 text-muted">{invite.redeemedByEmail ?? '—'}</td>
                  <td className="px-3 py-2.5 text-ink">{invite.guildName ?? '—'}</td>
                  <td className="px-3 py-2.5">
                    {status === 'LIVE' && <RevokeInviteButton inviteId={invite.id} />}
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
