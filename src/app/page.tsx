import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionContext } from '@/lib/session'

export default async function HomePage() {
  const session = await getSessionContext()
  if (session) redirect('/dashboard')

  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col justify-center px-6 py-16">
      <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-plasma">
        Guild operations
      </p>
      <h1 className="mt-3 text-5xl font-semibold tracking-tight text-ink sm:text-6xl">
        GuildMate
      </h1>
      <p className="mt-5 max-w-xl text-sm leading-relaxed text-muted">
        Register your guild, score live events with a time-limited code, settle rewards in a
        points auction, and trade gear in the guild store. Every point is written to an
        append-only ledger, and an event that nobody else joins is reversed automatically.
      </p>

      <div className="mt-9 flex flex-wrap gap-3">
        <Link
          href="/login"
          className="rounded-md border border-plasma/50 bg-plasma/15 px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-plasma transition-colors hover:bg-plasma/25"
        >
          Sign in
        </Link>
        <Link
          href="/register"
          className="rounded-md border border-edge px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-muted transition-colors hover:border-muted/60 hover:text-ink"
        >
          Join a guild
        </Link>
        <Link
          href="/register/guild"
          className="rounded-md border border-edge px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-muted transition-colors hover:border-muted/60 hover:text-ink"
        >
          Create a guild
        </Link>
      </div>

      <dl className="mt-16 grid gap-6 border-t border-edge pt-8 sm:grid-cols-3">
        {[
          ['Event codes', 'A code the admin sets, alive only for the window they choose.'],
          ['Quorum or reversal', 'Under three registrations in 48h and every point is clawed back.'],
          ['Mains spend, alts earn', 'Alt points roll up; only a main character can bid.'],
        ].map(([term, description]) => (
          <div key={term}>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink">
              {term}
            </dt>
            <dd className="mt-1.5 text-xs leading-relaxed text-muted">{description}</dd>
          </div>
        ))}
      </dl>
    </main>
  )
}
