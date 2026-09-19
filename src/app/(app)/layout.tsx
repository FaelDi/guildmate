import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { guilds } from '@/db/schema'
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
import { getOpenBanner, listStaffCandidates } from '@/services/loot'
import { getBalance } from '@/services/points'
import { getCurrentWeek, getMemberParticipation } from '@/services/weeks'

type Visibility = 'everyone' | 'admin' | 'superAdmin'

type NavKey = keyof Awaited<ReturnType<typeof getDictionary>>['nav']

const NAV: { href: string; key: NavKey; visibleTo: Visibility }[] = [
  { href: '/dashboard', key: 'ranking', visibleTo: 'everyone' },
  { href: '/classes', key: 'classes', visibleTo: 'everyone' },
  { href: '/loot', key: 'loot', visibleTo: 'everyone' },
  { href: '/meme', key: 'meme', visibleTo: 'everyone' },
  { href: '/bosses', key: 'bosses', visibleTo: 'everyone' },
  { href: '/events', key: 'events', visibleTo: 'everyone' },
  { href: '/profile', key: 'profile', visibleTo: 'everyone' },
  { href: '/admin', key: 'members', visibleTo: 'admin' },
  { href: '/admin/events', key: 'eventAdmin', visibleTo: 'admin' },
  { href: '/admin/recruit', key: 'recruit', visibleTo: 'admin' },
  { href: '/admin/log', key: 'audit', visibleTo: 'admin' },
  { href: '/admin/invites', key: 'invites', visibleTo: 'superAdmin' },
]

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The single gate for the whole authenticated area. Individual actions
  // re-check authorization against the row they touch; this only decides
  // whether the shell renders at all.
  const session = await getSessionContext()
  if (!session) redirect('/login')

  const { actor, now } = session
  const admin = isGuildAdmin(actor.role)

  const [guildRows, t, liveEvent, characters, settings, week, banner, balance, participation, staff] =
    await Promise.all([
      db.select().from(guilds).where(eq(guilds.id, actor.guildId)).limit(1),
      getDictionary(),
      getLiveEventForMember({ actor, now }),
      listOwnCharacters(actor.id),
      getSettings(actor.guildId),
      getCurrentWeek(actor.guildId),
      getOpenBanner(actor.guildId),
      getBalance(actor.id),
      getMemberParticipation({ guildId: actor.guildId, userId: actor.id }, db),
      admin ? listStaffCandidates(actor.guildId) : Promise.resolve([]),
    ])
  const guild = guildRows[0]
  const main = characters.find((c) => c.kind === 'MAIN' && c.isActive) ?? null

  return (
    <div id="app-root">
      <div className="header">
        <h1>
          {guild?.name ?? 'Guild'} {t.vx.commandCenter}
          <span className="semana-badge">
            {t.vx.week} {week.number}
          </span>
        </h1>
        <div style={{ display: 'flex', gap: 15, alignItems: 'center', flexWrap: 'wrap' }}>
          <LanguageSelector />
          {admin && <AdminToolbar hasOpenBanner={banner !== null} />}
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
          me={{
            userId: actor.id,
            isAdmin: admin,
            mainName: main?.name ?? null,
            balance: balance.available,
            participation,
          }}
          settings={{
            staffSharePct: settings.lootStaffSharePct,
            minParticipationPct: settings.lootMinParticipationPct,
          }}
          staff={staff}
        />
      )}

      <NavLinks
        items={NAV.filter((item) => {
          if (item.visibleTo === 'superAdmin') return actor.role === 'SUPER_ADMIN'
          if (item.visibleTo === 'admin') return admin
          return true
        }).map((item) => ({
          href: item.href,
          label: t.nav[item.key],
          admin: item.visibleTo !== 'everyone',
        }))}
      />

      <Rulers mega={settings.megaCpThreshold} titan={settings.titanCpThreshold} isAdmin={admin} />

      <main className="tab-content">{children}</main>

      <LiveDrawWatcher />

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
