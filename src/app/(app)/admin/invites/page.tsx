import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { IssueInviteForm, RevokeInviteButton } from '@/components/invite-admin'
import { Badge, Empty, Panel, Table } from '@/components/ui'
import { describeInviteStatus, INVITE_TTL_HOURS } from '@/lib/rules'
import { requireSession } from '@/lib/session'
import { listInvites } from '@/services/invites'

export const dynamic = 'force-dynamic'

function stamp(value: Date | null): string {
  return value ? value.toISOString().slice(0, 16).replace('T', ' ') : '—'
}

export default async function InvitesPage() {
  const { actor, now } = await requireSession()
  // Not a redirect: a member has no business learning that this screen exists.
  if (actor.role !== 'SUPER_ADMIN') notFound()

  const invites = await listInvites(actor)
  const headerList = await headers()
  const origin = `https://${headerList.get('host') ?? 'localhost:3000'}`

  return (
    <div className="space-y-6">
      <Panel
        title="Issue a guild invite"
        subtitle={`A single-use link, good for ${INVITE_TTL_HOURS} hours. It is the only way a guild is created.`}
        tone="ore"
      >
        <IssueInviteForm origin={origin} />
      </Panel>

      <Panel title="Invites" subtitle="The receipt for every guild on this server.">
        {invites.length === 0 ? (
          <Empty>No invite has been issued yet.</Empty>
        ) : (
          <Table head={['Token', 'For', 'Status', 'Expires', 'Redeemed by', 'Guild', '']}>
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
