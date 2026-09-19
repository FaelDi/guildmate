import type { ReactNode } from 'react'

/**
 * The shared vocabulary of the command center, as used by the older screens
 * (events, roster, admin, sign-in). They render the same `table-container`,
 * `input-edit` and table styles as the new tabs, so every screen reads as one
 * product. Colour always means a state: orange is not spendable yet, green is
 * spendable, red is a loss.
 */

type Tone = 'neutral' | 'ore' | 'refined' | 'slag'

const RAIL: Record<Tone, string> = {
  neutral: 'var(--neon-purple)',
  ore: 'var(--neon-orange)',
  refined: 'var(--neon-green)',
  slag: 'var(--neon-red)',
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
  /** Colours the side rail. Use it to state what the panel is about. */
  tone?: Tone
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`table-container ${className}`} style={{ borderLeftColor: RAIL[tone] }}>
      {(title || action) && (
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 15,
            marginBottom: 20,
            flexWrap: 'wrap',
          }}
        >
          <div>
            {title && <h2 style={{ margin: 0 }}>{title}</h2>}
            {subtitle && (
              <p style={{ margin: '6px 0 0', color: 'var(--text-muted)', fontSize: 16, maxWidth: 720 }}>
                {subtitle}
              </p>
            )}
          </div>
          {action}
        </header>
      )}
      {children}
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
  const color = tone === 'neutral' ? '#fff' : RAIL[tone]
  return (
    <div
      className="table-container"
      style={{ borderLeftColor: RAIL[tone], padding: '15px 20px', marginBottom: 0 }}
    >
      <div
        style={{
          fontSize: 14,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: 2,
          color: 'var(--text-muted)',
        }}
      >
        {label}
      </div>
      <div style={{ marginTop: 6, fontSize: 32, fontWeight: 700, color, textShadow: `0 0 12px ${color}55` }}>
        {value}
      </div>
      {hint && <div style={{ marginTop: 6, fontSize: 14, color: 'var(--text-muted)' }}>{hint}</div>}
    </div>
  )
}

/** The status chip lives in its own client module: it reads the dictionary. */
export { Badge } from './badge'

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        fontSize: 14,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: 4,
        color: 'var(--neon-cyan)',
        margin: 0,
      }}
    >
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
      <span className="field-label" style={{ marginTop: 0 }}>
        {label}
      </span>
      {children}
      {hint && (
        <span style={{ display: 'block', marginTop: 6, fontSize: 14, color: 'var(--text-muted)' }}>{hint}</span>
      )}
    </label>
  )
}

const CONTROL = 'input-edit w-full'

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input {...props} className={`${CONTROL} ${props.className ?? ''}`} style={{ textAlign: 'left', ...props.style }} />
  )
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`${CONTROL} ${props.className ?? ''}`} style={{ textAlign: 'left', ...props.style }} />
  )
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`${CONTROL} min-h-20 ${props.className ?? ''}`}
      style={{ textAlign: 'left', ...props.style }}
    />
  )
}

export function Table({ head, children }: { head: readonly string[]; children: ReactNode }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            {head.map((label, index) => (
              <th key={label || `col-${index}`} className="left">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="legacy-rows">{children}</tbody>
      </table>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        border: '1px dashed var(--glass-border)',
        padding: '40px 15px',
        textAlign: 'center',
        color: 'var(--text-muted)',
        fontSize: 18,
        margin: 0,
      }}
    >
      {children}
    </p>
  )
}
