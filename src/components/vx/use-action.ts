'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { useErrorMessage } from '@/components/locale-provider'
import type { ActionResult } from '@/lib/errors'
import { useToast } from './toast'

/**
 * Runs a server action the way every command-center control does: disable
 * while pending, toast the outcome in the player's language, and re-render
 * the server components so every table shows the new state.
 */
export function useActionRunner() {
  const router = useRouter()
  const toast = useToast()
  const translate = useErrorMessage()
  const [pending, setPending] = useState(false)

  const run = useCallback(
    async <T,>(
      action: () => Promise<ActionResult<T>>,
      success?: string | ((data: T) => string),
    ): Promise<ActionResult<T>> => {
      setPending(true)
      try {
        const result = await action()
        if (result.ok) {
          if (success) toast(typeof success === 'function' ? success(result.data) : success, 'sucesso')
          router.refresh()
        } else {
          toast(translate(result.code, result.message), 'erro')
        }
        return result
      } catch {
        toast(translate('SERVICE_UNAVAILABLE', 'Connection failure.'), 'erro')
        return { ok: false, code: 'NETWORK', message: 'Connection failure.' }
      } finally {
        setPending(false)
      }
    },
    [router, toast, translate],
  )

  return { run, pending }
}
