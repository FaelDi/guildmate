import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/db'
import { signOutAction } from '@/app/actions/auth'
import { NavLinks } from '@/components/nav-links'
import { LiveEventWidget } from '@/components/live-event-widget'
import { AdminToolbar } from '@/components/vx/admin-toolbar'
import { LanguageSelector } from '@/components/vx/language-selector'
import { LiveDrawWatcher } from '@/components/vx/live-draw'
import { LootBanner } from '@/components/vx/loot-banner'
import { Rulers } from '@/components/vx/rulers'
import { getDictionary } from '@/lib/i18n'
import { isGuildAdmin } from '@/lib/rules'
import { getSessionContext, getSettings } from '@/lib/session'
import { listOwnCharacters } from '@/services/accounts'
import { getLiveEventForMember } from '@/services/events'
import { getPrimaryGuild } from '@/services/guilds'
import { getOpenBanner, listStaffCandidates } from '@/services/loot'
import { getBalance } from '@/services/points'
import { getCurrentWeek, getMemberParticipation } from '@/services/weeks'

type Visibility = 'public' | 'member' | 'admin' | 'superAdmin'

type NavKey = keyof Awaited<ReturnType<typeof getDictionary>>['nav']

/**
 * The board is public, the way the guild's old dashboard was: a visitor reads
 * the ranking, the builds, the loot log and the boss schedule without an
 * account. Signing in is what unlocks *doing* things - registering for an
 * event, betting, editing your own character - and the admin tabs.
 */
const NAV: { href: string; key: NavKey; visibleTo: Visibility }[] = [
  { href: '/dashboard', key: 'ranking', visibleTo: 'public' },
  { href: '/classes', key: 'classes', visibleTo: 'public' },
  { href: '/loot', key: 'loot', visibleTo: 'public' },
  { href: '/meme', key: 'meme', visibleTo: 'public' },
  { href: '/bosses', key: 'bosses', visibleTo: 'public' },
  { href: '/events', key: 'events', visibleTo: 'member' },
  { href: '/profile', key: 'profile', visibleTo: 'member' },
  { href: '/admin', key: 'members', visibleTo: 'admin' },
  { href: '/admin/events', key: 'eventAdmin', visibleTo: 'admin' },
  { href: '/admin/recruit', key: 'recruit', visibleTo: 'admin' },
  { href: '/admin/log', key: 'audit', visibleTo: 'admin' },
  { href: '/admin/invites', key: 'invites', visibleTo: 'superAdmin' },
]

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionContext()
  const t = await getDictionary()

  // Signed in: their own guild. Otherwise the guild this deployment is for.
  const guild = session
    ? ((await db.query.guilds.findFirst({ where: (g, { eq }) => eq(g.id, session.actor.guildId) })) ??
      null)
    : await getPrimaryGuild()
  if (!guild) notFound()

  const admin = session ? isGuildAdmin(session.actor.role) : false

  const [liveEvent, characters, settings, week, banner, balance, participation, staff] =
    await Promise.all([
      session ? getLiveEventForMember({ actor: session.actor, now: session.now }) : null,
      session ? listOwnCharacters(session.actor.id) : [],
      getSettings(guild.id),
      getCurrentWeek(guild.id),
      getOpenBanner(guild.id),
      session ? getBalance(session.actor.id) : { pending: 0, available: 0 },
      session
        ? getMemberParticipation({ guildId: guild.id, userId: session.actor.id }, db)
        : 0,
      admin ? listStaffCandidates(guild.id) : [],
    ])

  const main = characters.find((c) => c.kind === 'MAIN' && c.isActive) ?? null

  return (
    <div id="app-root">
      <div className="header">
        <h1>
          {guild.name} {t.vx.commandCenter}
          <span className="semana-badge">
            {t.vx.week} {week.number}
          </span>
        </h1>
        <div style={{ display: 'flex', gap: 15, alignItems: 'center', flexWrap: 'wrap' }}>
          <LanguageSelector />
          {admin && <AdminToolbar hasOpenBanner={banner !== null} />}
          {session ? (
            <>
              <span style={{ color: 'var(--text-muted)', fontSize: 16 }}>
                {t.vx.signedAs}{' '}
                <b style={{ color: admin ? 'var(--neon-red)' : 'var(--neon-cyan)' }}>
                  {main?.name ?? session.user.email}
                </b>
              </span>
              <form action={signOutAction}>
                <button type="submit" className="btn btn-outline">
                  🔒 {t.vx.signOut}
                </button>
              </form>
            </>
          ) : (
            <Link href="/login" className="btn btn-outline">
              🔒 {t.vx.memberAccess}
            </Link>
          )}
        </div>
      </div>

      {banner && (
        <LootBanner
          banner={{
            id: banner.id,
            title: banner.title,
            closesAtMs: banner.closesAt?.getTime() ?? null,
            items: banner.items,
          }}
          me={
            session
              ? {
                  userId: session.actor.id,
                  isAdmin: admin,
                  mainName: main?.name ?? null,
                  balance: balance.available,
                  participation,
                }
              : null
          }
          settings={{
            staffSharePct: settings.lootStaffSharePct,
            minParticipationPct: settings.lootMinParticipationPct,
          }}
          staff={staff}
        />
      )}

      <NavLinks
        items={NAV.filter((item) => {
          if (item.visibleTo === 'superAdmin') return session?.actor.role === 'SUPER_ADMIN'
          if (item.visibleTo === 'admin') return admin
          if (item.visibleTo === 'member') return session !== null
          return true
        }).map((item) => ({
          href: item.href,
          label: t.nav[item.key],
          admin: item.visibleTo === 'admin' || item.visibleTo === 'superAdmin',
        }))}
      />

      <Rulers mega={settings.megaCpThreshold} titan={settings.titanCpThreshold} isAdmin={admin} />

      <main className="tab-content">{children}</main>

      {session && <LiveDrawWatcher />}

      {liveEvent && (
        <LiveEventWidget
          event={{
            id: liveEvent.id,
            name: liveEvent.name,
            pointsValue: liveEvent.pointsValue,
            closesAt: liveEvent.registrationClosesAt.toISOString(),
            registrationCount: liveEvent.registrationCount,
            minParticipants: liveEvent.minParticipants,
          }}
          characters={characters.map((c) => ({
            id: c.id,
            name: c.name,
            kind: c.kind,
            level: c.level,
          }))}
        />
      )}
    </div>
  )
}
