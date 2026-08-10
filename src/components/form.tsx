'use client'

import { useFormStatus } from 'react-dom'
import type { ReactNode } from 'react'
import type { ActionResult } from '@/lib/errors'

export function SubmitButton({
  children,
  variant = 'primary',
  className = '',
}: {
  children: ReactNode
  variant?: 'primary' | 'ghost' | 'danger'
  className?: string
}) {
  const { pending } = useFormStatus()

  const variants = {
    primary: 'bg-plasma/15 border-plasma/50 text-plasma hover:bg-plasma/25',
    ghost: 'bg-transparent border-edge text-muted hover:text-ink hover:border-muted/60',
    danger: 'bg-blood/12 border-blood/45 text-blood hover:bg-blood/20',
  }[variant]

  return (
    <button
      type="submit"
      disabled={pending}
      className={`inline-flex items-center justify-center rounded-md border px-3.5 py-2 text-xs font-semibold uppercase tracking-[0.1em] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variants} ${className}`}
    >
      {pending ? 'Working...' : children}
    </button>
  )
}

/**
 * Renders whatever the action returned. Failures carry a code and a message
 * that were vetted server-side, so nothing here can leak an internal detail.
 */
export function FormMessage({
  state,
  success,
}: {
  state: ActionResult<unknown> | null
  success?: ReactNode
}) {
  if (!state) return null

  if (!state.ok) {
    return (
      <p
        role="alert"
        className="rounded-md border border-blood/40 bg-blood/10 px-3 py-2 text-xs text-blood"
      >
        {state.message}
      </p>
    )
  }

  if (!success) return null
  return (
    <div className="rounded-md border border-toxic/40 bg-toxic/10 px-3 py-2 text-xs text-toxic">
      {success}
    </div>
  )
}
