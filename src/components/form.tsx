'use client'

import { useFormStatus } from 'react-dom'
import type { ReactNode } from 'react'
import { useDictionary, useErrorMessage } from '@/components/locale-provider'
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
  const dictionary = useDictionary()

  const variants = {
    primary: 'btn-success',
    ghost: 'btn-muted',
    danger: 'btn-red',
  }[variant]

  return (
    <button type="submit" disabled={pending} className={`btn ${variants} ${className}`}>
      {pending ? dictionary.common.working : children}
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
  const translate = useErrorMessage()

  if (!state) return null

  if (!state.ok) {
    return (
      <p
        role="alert"
        className="toast toast-erro show"
        style={{ position: 'static', pointerEvents: 'auto' }}
      >
        {/* Denials travel as a stable code; the English text the domain layer
            produced is the fallback for anything not translated yet. */}
        {translate(state.code, state.message)}
      </p>
    )
  }

  if (!success) return null
  return (
    <div className="toast toast-sucesso show" style={{ position: 'static' }}>
      {success}
    </div>
  )
}
