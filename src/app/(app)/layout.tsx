import Link from 'next/link'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { guilds } from '@/db/schema'
import { signOutAction } from '@/app/actions/auth'
import { Badge } from '@/components/ui'
import { isGuildAdmin } from '@/lib/rules'
import { getSessionContext } from '@/lib/session'

const NAV = [
  { href: '/dashboard', label: 'Dashboard', adminOnly: false },
  { href: '/profile', label: 'Characters', adminOnly: false },
  { href: '/events', label: 'Events', adminOnly: false },
  { href: '/auctions', label: 'Auctions', adminOnly: false },
  { href: '/market', label: 'Store', adminOnly: false },
  { href: '/admin', label: 'Members', adminOnly: true },
  { href: '/admin/events', label: 'Event admin', adminOnly: true },
  { href: '/admin/log', label: 'Audit', adminOnly: true },
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
      <header className="sticky top-0 z-20 border-b border-edge bg-void/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3">
          <Link href="/dashboard" className="font-mono text-[11px] uppercase tracking-[0.3em] text-plasma">
            GuildMate
          </Link>

          <span className="text-xs text-muted">
            {guild?.name ?? 'Guild'}
            {guild?.tag && <span className="ml-1.5 font-mono text-muted/70">[{guild.tag}]</span>}
          </span>

          <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            {NAV.filter((item) => !item.adminOnly || admin).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-muted transition-colors hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <Badge value={actor.role} />
            <span className="hidden text-xs text-muted sm:inline">{user.email}</span>
            <form action={signOutAction}>
              <button
                type="submit"
                className="rounded border border-edge px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted transition-colors hover:border-blood/50 hover:text-blood"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  )
}
