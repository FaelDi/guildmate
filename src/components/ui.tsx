import type { ReactNode } from 'react'

/**
 * The shared visual vocabulary: one hairline border, one panel surface, one
 * accent per semantic meaning. Every screen composes these rather than
 * inventing its own spacing and colour, so the portal reads as one system.
 */

export function Panel({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title?: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={`rounded-lg border border-edge bg-panel/70 backdrop-blur-sm ${className}`}
    >
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-edge px-5 py-3.5">
          <div>
            {title && (
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-ink">
                {title}
              </h2>
            )}
            {subtitle && <p className="mt-1 text-xs text-muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  )
}

export function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: string | number
  hint?: string
  tone?: 'default' | 'plasma' | 'ember' | 'toxic'
}) {
  const toneClass = {
    default: 'text-ink',
    plasma: 'text-plasma',
    ember: 'text-ember',
    toxic: 'text-toxic',
  }[tone]

  return (
    <div className="rounded-md border border-edge bg-panel-raised/60 px-4 py-3">
      <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted">{label}</div>
      <div className={`mt-1 font-mono text-2xl tabular-nums ${toneClass}`}>{value}</div>
      {hint && <div className="mt-1 text-[11px] text-muted">{hint}</div>}
    </div>
  )
}

const BADGE_TONES: Record<string, string> = {
  OPEN: 'border-plasma/40 bg-plasma/10 text-plasma',
  CONFIRMED: 'border-toxic/40 bg-toxic/10 text-toxic',
  PENDING: 'border-ember/40 bg-ember/10 text-ember',
  PENDING_CONFIRMATION: 'border-ember/40 bg-ember/10 text-ember',
  CANCELLED: 'border-blood/40 bg-blood/10 text-blood',
  REVERSED: 'border-blood/40 bg-blood/10 text-blood',
  BANNED: 'border-blood/40 bg-blood/10 text-blood',
  DELETED: 'border-blood/50 bg-blood/15 text-blood',
  INACTIVE: 'border-edge bg-panel-raised text-muted',
  ACTIVE: 'border-toxic/40 bg-toxic/10 text-toxic',
  LEGENDARY: 'border-ember/50 bg-ember/12 text-ember',
  EPIC: 'border-[#c084fc]/45 bg-[#c084fc]/12 text-[#d8b4fe]',
  RARE: 'border-plasma/40 bg-plasma/10 text-plasma',
  UNCOMMON: 'border-toxic/35 bg-toxic/8 text-toxic',
  COMMON: 'border-edge bg-panel-raised text-muted',
  MAIN: 'border-plasma/40 bg-plasma/10 text-plasma',
  ALT: 'border-edge bg-panel-raised text-muted',
  LEADER: 'border-ember/45 bg-ember/12 text-ember',
  VICE_LEADER: 'border-plasma/40 bg-plasma/10 text-plasma',
  SUPER_ADMIN: 'border-blood/40 bg-blood/10 text-blood',
  MEMBER: 'border-edge bg-panel-raised text-muted',
}

export function Badge({ value, children }: { value: string; children?: ReactNode }) {
  const tone = BADGE_TONES[value] ?? 'border-edge bg-panel-raised text-muted'
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${tone}`}
    >
      {children ?? value.replace(/_/g, ' ')}
    </span>
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
      <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  )
}

const CONTROL =
  'w-full rounded-md border border-edge bg-void/60 px-3 py-2 text-sm text-ink outline-none ' +
  'placeholder:text-muted/60 focus:border-plasma/60 focus:ring-1 focus:ring-plasma/30'

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
            {head.map((label) => (
              <th
                key={label}
                className="whitespace-nowrap px-3 py-2 text-left text-[10px] font-medium uppercase tracking-[0.14em] text-muted"
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
    <p className="rounded-md border border-dashed border-edge px-4 py-8 text-center text-sm text-muted">
      {children}
    </p>
  )
}
