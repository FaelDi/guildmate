import Link from 'next/link'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { guilds } from '@/db/schema'
import { signOutAction } from '@/app/actions/auth'
import { NavLinks, type NavItem } from '@/components/nav-links'
import { Badge } from '@/components/ui'
import { isGuildAdmin } from '@/lib/rules'
import { getSessionContext } from '@/lib/session'

type Visibility = 'everyone' | 'admin' | 'superAdmin'

const NAV: (NavItem & { visibleTo: Visibility })[] = [
  { href: '/dashboard', label: 'Dashboard', visibleTo: 'everyone' },
  { href: '/profile', label: 'Characters', visibleTo: 'everyone' },
  { href: '/events', label: 'Events', visibleTo: 'everyone' },
  { href: '/auctions', label: 'Auctions', visibleTo: 'everyone' },
  { href: '/market', label: 'Store', visibleTo: 'everyone' },
  { href: '/admin', label: 'Members', visibleTo: 'admin' },
  { href: '/admin/events', label: 'Event admin', visibleTo: 'admin' },
  { href: '/admin/log', label: 'Audit', visibleTo: 'admin' },
  { href: '/admin/invites', label: 'Invites', visibleTo: 'superAdmin' },
]

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The single gate for the whole authenticated area. Individual actions
  // re-check authorization against the row they touch; this only decides
  // whether the shell renders at all.
  const session = await getSessionContext()
  if (!session) redirect('/login')

  const { actor, user } = session
  const admin = isGuildAdmin(actor.role)
  const [guild] = await db.select().from(guilds).where(eq(guilds.id, actor.guildId)).limit(1)

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-edge bg-void/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3">
          <Link href="/dashboard" className="group flex items-baseline gap-2.5">
            <span className="font-display text-sm font-bold uppercase tracking-[0.26em] text-ore">
              GuildMate
            </span>
            <span className="font-mono text-[11px] text-muted">
              {guild?.name ?? 'Guild'}
              {guild?.tag && <span className="ml-1.5 text-muted/70">[{guild.tag}]</span>}
            </span>
          </Link>

          <NavLinks
            items={NAV.filter((item) => {
              if (item.visibleTo === 'superAdmin') return actor.role === 'SUPER_ADMIN'
              if (item.visibleTo === 'admin') return admin
              return true
            })}
          />

          <div className="ml-auto flex items-center gap-3">
            <Badge value={actor.role} />
            <span className="hidden font-mono text-[11px] text-muted sm:inline">{user.email}</span>
            <form action={signOutAction}>
              <button
                type="submit"
                className="notch-control border border-edge px-2.5 py-1 font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-muted transition-colors hover:border-slag/50 hover:text-slag"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
        <div aria-hidden className="h-px w-full bg-gradient-to-r from-ore/50 via-edge to-transparent" />
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  )
}
