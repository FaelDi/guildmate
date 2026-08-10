import type { ReactNode } from 'react'

/**
 * The shared vocabulary of the terminal.
 *
 * Two silhouettes carry the whole system: a panel is cut at the top-right, a
 * control is cut at the bottom-left. Everything else is one hairline, one
 * surface, and colour that always means a state - amber is unrefined, teal is
 * spendable, red is reversed.
 */

type Tone = 'neutral' | 'ore' | 'refined' | 'slag'

const RAIL: Record<Tone, string> = {
  neutral: 'bg-edge',
  ore: 'bg-ore',
  refined: 'bg-refined',
  slag: 'bg-slag',
}

export function Panel({
  title,
  subtitle,
  action,
  tone = 'neutral',
  children,
  className = '',
}: {
  title?: string
  subtitle?: string
  action?: ReactNode
  /** Colours the header rail. Use it to state what the panel is about. */
  tone?: Tone
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={`notch-panel tick relative border border-edge bg-panel/80 backdrop-blur-sm ${className}`}
    >
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-edge px-5 py-3.5">
          <div>
            {title && (
              <h2 className="font-display text-[13px] font-semibold uppercase tracking-[0.18em] text-ink">
                {title}
              </h2>
            )}
            {subtitle && <p className="mt-1 max-w-prose text-xs text-muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div aria-hidden className={`h-px w-full ${RAIL[tone]} opacity-70`} />
      <div className="p-5">{children}</div>
    </section>
  )
}

export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string
  value: string | number
  hint?: string
  tone?: Tone
}) {
  const valueClass = {
    neutral: 'text-ink',
    ore: 'text-ore',
    refined: 'text-refined',
    slag: 'text-slag',
  }[tone]

  return (
    <div className="notch-panel relative border border-edge bg-panel-raised/70 px-4 py-3.5">
      <div
        aria-hidden
        className={`absolute left-0 top-0 h-full w-[2px] ${RAIL[tone]} opacity-80`}
      />
      <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className={`mt-1.5 font-mono text-[28px] leading-none tabular-nums ${valueClass}`}>
        {value}
      </div>
      {hint && <div className="mt-2 text-[11px] leading-relaxed text-muted">{hint}</div>}
    </div>
  )
}

const BADGE_TONES: Record<string, string> = {
  // Point and event lifecycle.
  PENDING: 'border-ore/45 bg-ore/10 text-ore',
  PENDING_CONFIRMATION: 'border-ore/45 bg-ore/10 text-ore',
  OPEN: 'border-ore/45 bg-ore/10 text-ore',
  CONFIRMED: 'border-refined/45 bg-refined/10 text-refined',
  SETTLED: 'border-refined/45 bg-refined/10 text-refined',
  ACTIVE: 'border-refined/45 bg-refined/10 text-refined',
  SOLD: 'border-refined/45 bg-refined/10 text-refined',
  CANCELLED: 'border-slag/45 bg-slag/10 text-slag',
  REVERSED: 'border-slag/45 bg-slag/10 text-slag',
  BANNED: 'border-slag/45 bg-slag/10 text-slag',
  DELETED: 'border-slag/55 bg-slag/15 text-slag',
  EXPIRED: 'border-edge bg-panel-raised text-muted',
  INACTIVE: 'border-edge bg-panel-raised text-muted',

  // Item rarity.
  LEGENDARY: 'border-ore/55 bg-ore/12 text-ore',
  EPIC: 'border-cora/50 bg-cora/12 text-cora',
  RARE: 'border-accretia/50 bg-accretia/12 text-accretia',
  UNCOMMON: 'border-refined/40 bg-refined/8 text-refined',
  COMMON: 'border-edge bg-panel-raised text-muted',

  // Roster.
  MAIN: 'border-ore/45 bg-ore/10 text-ore',
  ALT: 'border-edge bg-panel-raised text-muted',

  // The three nations.
  BELLATO: 'border-bellato/45 bg-bellato/10 text-bellato',
  CORA: 'border-cora/45 bg-cora/10 text-cora',
  ACCRETIA: 'border-accretia/45 bg-accretia/12 text-accretia',

  // Rank.
  LEADER: 'border-ore/50 bg-ore/12 text-ore',
  VICE_LEADER: 'border-cora/45 bg-cora/10 text-cora',
  SUPER_ADMIN: 'border-slag/45 bg-slag/10 text-slag',
  MEMBER: 'border-edge bg-panel-raised text-muted',
}

export function Badge({ value, children }: { value: string; children?: ReactNode }) {
  const tone = BADGE_TONES[value] ?? 'border-edge bg-panel-raised text-muted'
  return (
    <span
      className={`inline-flex items-center border px-1.5 py-0.5 font-mono text-[10px] uppercase leading-4 tracking-wider ${tone}`}
    >
      {children ?? value.replace(/_/g, ' ')}
    </span>
  )
}

/** The small uppercase line that says what a region of the screen is. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="font-display text-[11px] font-semibold uppercase tracking-[0.32em] text-ore">
      {children}
    </p>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1.5 block text-[11px] leading-relaxed text-muted">{hint}</span>}
    </label>
  )
}

const CONTROL =
  'notch-control w-full border border-edge bg-void/70 px-3 py-2 text-sm text-ink outline-none ' +
  'transition-colors placeholder:text-muted/60 hover:border-muted/50 focus:border-ore/70'

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${CONTROL} ${props.className ?? ''}`} />
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${CONTROL} ${props.className ?? ''}`} />
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${CONTROL} min-h-20 ${props.className ?? ''}`} />
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead>
          <tr className="border-b border-edge">
            {head.map((label, index) => (
              <th
                key={label || `col-${index}`}
                className="whitespace-nowrap px-3 py-2 text-left font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-muted"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-edge/60">{children}</tbody>
      </table>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="border border-dashed border-edge px-4 py-8 text-center text-sm text-muted">
      {children}
    </p>
  )
}
