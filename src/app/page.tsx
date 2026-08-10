import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FactionSigil, OreCore } from '@/components/hud-art'
import { Eyebrow } from '@/components/ui'
import { getSessionContext } from '@/lib/session'

/** The three states every point passes through - the whole thesis of the app. */
const LIFECYCLE = [
  {
    state: 'RAW',
    mark: 'bg-ore',
    text: 'text-ore',
    line: 'Redeeming the code books the points at once. They are not spendable yet.',
  },
  {
    state: 'REFINED',
    mark: 'bg-refined',
    text: 'text-refined',
    line: 'The event reaches its minimum turnout and those same points become spendable.',
  },
  {
    state: 'SLAG',
    mark: 'bg-slag',
    text: 'text-slag',
    line: 'Turnout misses the deadline. The event is cancelled and every point is reversed.',
  },
]

/**
 * Creating a guild is not offered here on purpose: it needs an invite link,
 * and a button that leads to "you cannot do this" is worse than no button.
 */
const ACTIONS = [
  { href: '/login', label: 'Sign in', primary: true },
  { href: '/register', label: 'Join a guild', primary: false },
]

export default async function HomePage() {
  const session = await getSessionContext()
  if (session) redirect('/dashboard')

  return (
    <main className="relative mx-auto grid min-h-dvh max-w-6xl grid-cols-1 items-center gap-12 px-6 py-16 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
      {/* The core sits behind the type, bled off the right edge, so the page
          reads as a window onto something larger than the layout. */}
      <OreCore className="pointer-events-none absolute -right-40 top-1/2 hidden h-[820px] w-[820px] -translate-y-1/2 opacity-70 lg:block" />
      <OreCore className="pointer-events-none absolute -right-24 -top-24 h-[420px] w-[420px] opacity-40 lg:hidden" />

      <div className="relative">
        <Eyebrow>GuildMate — operations terminal</Eyebrow>

        <h1 className="mt-5 font-display text-6xl font-bold uppercase leading-[0.9] tracking-tight text-ink sm:text-7xl">
          Points are
          <br />
          <span className="text-ore">mined</span>, not
          <br />
          minted.
        </h1>

        <p className="mt-7 max-w-md text-sm leading-relaxed text-muted">
          Run your guild&apos;s events, auctions and store on a ledger nobody can quietly edit.
          An admin announces a code that dies on schedule, players redeem it, and the points
          only turn spendable once enough people actually showed up.
        </p>

        <div className="mt-10 flex flex-wrap gap-3">
          {ACTIONS.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className={`notch-control border px-6 py-3 font-display text-xs font-semibold uppercase tracking-[0.16em] transition-colors ${
                action.primary
                  ? 'border-ore/55 bg-ore/12 text-ore hover:bg-ore/22'
                  : 'border-edge text-muted hover:border-muted/60 hover:text-ink'
              }`}
            >
              {action.label}
            </Link>
          ))}
        </div>
      </div>

      <section
        aria-label="The life of one point"
        className="notch-panel tick relative overflow-hidden border border-edge bg-panel/80 backdrop-blur-sm"
      >
        {/* The only thing on the site that moves by itself: a survey sweep. */}
        <div
          aria-hidden
          className="sweep pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-transparent via-ore/10 to-transparent"
        />

        <header className="border-b border-edge px-5 py-3.5">
          <h2 className="font-display text-[13px] font-semibold uppercase tracking-[0.18em] text-ink">
            The life of one point
          </h2>
        </header>

        <ol className="divide-y divide-edge/60">
          {LIFECYCLE.map((phase, index) => (
            <li key={phase.state} className="flex gap-4 px-5 py-5">
              <div className="flex flex-col items-center gap-2 pt-1.5">
                <span aria-hidden className={`h-2.5 w-2.5 ${phase.mark}`} />
                {index < LIFECYCLE.length - 1 && (
                  <span aria-hidden className="w-px flex-1 bg-edge" />
                )}
              </div>
              <div>
                <div className={`font-mono text-[11px] uppercase tracking-[0.22em] ${phase.text}`}>
                  {phase.state}
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-muted">{phase.line}</p>
              </div>
            </li>
          ))}
        </ol>

        <footer className="border-t border-edge px-5 py-3.5 text-[11px] leading-relaxed text-muted">
          Corrections are new rows, never edits. An alt&apos;s points roll up to its main, and
          only a main can bid at auction.
        </footer>
      </section>

      <section
        aria-label="The three nations"
        className="relative grid gap-6 border-t border-edge pt-8 sm:grid-cols-3 lg:col-span-2"
      >
        {(['BELLATO', 'CORA', 'ACCRETIA'] as const).map((nation) => (
          <FactionSigil key={nation} nation={nation} />
        ))}
      </section>
    </main>
  )
}
