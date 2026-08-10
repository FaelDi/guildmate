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

/** The status chip lives in its own client module: it reads the dictionary. */
export { Badge } from "./badge"

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

export function Table({ head, children }: { head: readonly string[]; children: ReactNode }) {
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
