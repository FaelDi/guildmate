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
    primary: 'border-ore/55 bg-ore/12 text-ore hover:bg-ore/22',
    ghost: 'border-edge bg-transparent text-muted hover:border-muted/60 hover:text-ink',
    danger: 'border-slag/50 bg-slag/12 text-slag hover:bg-slag/20',
  }[variant]

  return (
    <button
      type="submit"
      disabled={pending}
      className={`notch-control inline-flex items-center justify-center border px-4 py-2 font-display text-xs font-semibold uppercase tracking-[0.16em] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variants} ${className}`}
    >
      {pending ? 'Working' : children}
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
        className="notch-control border border-slag/45 bg-slag/10 px-3 py-2 text-xs leading-relaxed text-slag"
      >
        {state.message}
      </p>
    )
  }

  if (!success) return null
  return (
    <div className="notch-control border border-refined/45 bg-refined/10 px-3 py-2 text-xs leading-relaxed text-refined">
      {success}
    </div>
  )
}
