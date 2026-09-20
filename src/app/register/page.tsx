import Link from 'next/link'
import { JoinGuildForm } from '@/components/join-guild-form'
import { Panel } from '@/components/ui'
import { PublicHeader } from '@/components/vx/public-header'
import { getDictionary } from '@/lib/i18n'
import { getPrimaryGuild } from '@/services/guilds'
import { peekMemberInvite } from '@/services/member-invites'

export const dynamic = 'force-dynamic'

/**
 * Sign-up. This deployment belongs to one guild, so there is nothing to pick:
 * an open sign-up joins it and waits for an admin to approve. A link overrides
 * that - it names its own guild and arrives already vouched for.
 */
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const token = (await searchParams).token?.trim() ?? ''
  const t = await getDictionary()
  const [primary, invite] = await Promise.all([
    getPrimaryGuild(),
    token ? peekMemberInvite(token, new Date()) : null,
  ])

  // A dead link falls back to the plain sign-up rather than a dead end.
  const liveInvite =
    invite && invite.status === 'LIVE' && invite.guildName
      ? { token, guildName: invite.guildName, seatsLeft: invite.seatsLeft }
      : null

  const guildName = liveInvite?.guildName ?? primary?.name ?? ''

  return (
    <main>
      <PublicHeader signInLabel={t.vx.memberAccess} joinLabel={t.auth.createAccount} />

      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <Panel
          title={`${t.recruit.joinTitle} ${guildName}`}
          subtitle={liveInvite ? t.recruit.joinSubtitle : t.vx.joinSubtitle}
          tone={liveInvite ? 'ore' : 'neutral'}
        >
          {liveInvite && liveInvite.seatsLeft > 1 && (
            <p style={{ color: 'var(--neon-orange)', fontSize: 14, letterSpacing: 1 }}>
              {liveInvite.seatsLeft} {t.recruit.seatsLeft}
            </p>
          )}

          {!liveInvite && (
            <p
              style={{
                border: '1px solid var(--neon-orange)',
                background: 'rgba(255,170,0,0.08)',
                color: 'var(--neon-orange)',
                padding: 12,
                fontSize: 15,
              }}
            >
              {t.vx.approvalNotice}
            </p>
          )}

          <JoinGuildForm invite={liveInvite} />

          <p style={{ marginTop: 16, color: 'var(--text-muted)', fontSize: 15 }}>
            {t.vx.alreadyHaveAccount}
          </p>

          <p style={{ marginTop: 20, color: 'var(--text-muted)', fontSize: 15 }}>
            {t.auth.alreadyMember}{' '}
            <Link href="/login" style={{ color: 'var(--neon-cyan)' }}>
              {t.common.signIn}
            </Link>
          </p>
        </Panel>
      </div>
    </main>
  )
}
