'use client'

import { useActionState, useEffect, useState } from 'react'
import { redeemCodeAction } from '@/app/actions/events'
import { FormMessage, SubmitButton } from '@/components/form'
import { useDictionary } from '@/components/locale-provider'
import { Input, Select } from '@/components/ui'
import type { CharacterOption } from './redeem-code-form'

export type LiveEvent = {
  id: string
  name: string
  pointsValue: number
  /** ISO string: a Date cannot cross the server/client boundary intact. */
  closesAt: string
  registrationCount: number
  minParticipants: number
}

/**
 * The floating "there is an event running" panel.
 *
 * It exists because the code has a deadline and the dashboard does not follow
 * you around. Two things keep it from being an annoyance: it never appears for
 * somebody who already registered, and dismissing it sticks for that event
 * until the tab is closed.
 *
 * The countdown is the honest part of the design - it is the one fact the
 * player needs and the reason to interrupt them at all.
 */
export function LiveEventWidget({
  event,
  characters,
}: {
  event: LiveEvent
  characters: CharacterOption[]
}) {
  const t = useDictionary()
  const [state, formAction] = useActionState(redeemCodeAction, null)

  const [open, setOpen] = useState(true)
  const [dismissed, setDismissed] = useState(false)
  const [remaining, setRemaining] = useState<number | null>(null)

  // Rendering the clock only after mount avoids a hydration mismatch: the
  // server's "now" is always a little behind the browser's.
  useEffect(() => {
    const deadline = new Date(event.closesAt).getTime()
    const tick = () => setRemaining(Math.max(0, deadline - Date.now()))

    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [event.closesAt])

  useEffect(() => {
    setDismissed(window.sessionStorage.getItem(`gm_event_dismissed:${event.id}`) === '1')
  }, [event.id])

  function dismiss() {
    window.sessionStorage.setItem(`gm_event_dismissed:${event.id}`, '1')
    setDismissed(true)
  }

  if (dismissed) return null

  const expired = remaining !== null && remaining <= 0
  const registered = state?.ok === true

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="notch-control fixed bottom-4 right-4 z-30 flex items-center gap-2 border border-ore/55 bg-panel/95 px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-ore shadow-lg backdrop-blur transition-colors hover:bg-ore/12"
      >
        <span aria-hidden className="h-2 w-2 bg-ore" />
        {t.liveEvent.reopen}
        <span className="font-mono tabular-nums">{formatRemaining(remaining)}</span>
      </button>
    )
  }

  return (
    <aside
      aria-label={t.liveEvent.title}
      className="notch-panel tick fixed bottom-4 right-4 z-30 w-[min(22rem,calc(100vw-2rem))] border border-ore/45 bg-panel/95 shadow-2xl backdrop-blur"
    >
      <header className="flex items-start justify-between gap-3 border-b border-edge px-4 py-2.5">
        <div>
          <p className="font-display text-[10px] font-semibold uppercase tracking-[0.2em] text-ore">
            {t.liveEvent.title}
          </p>
          <p className="mt-0.5 text-sm font-medium text-ink">{event.name}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t.liveEvent.minimize}
            className="text-xs text-muted transition-colors hover:text-ink"
          >
            —
          </button>
          <button
            type="button"
            onClick={dismiss}
            aria-label={t.common.close}
            className="text-xs text-muted transition-colors hover:text-slag"
          >
            ✕
          </button>
        </div>
      </header>

      <div aria-hidden className={`h-px w-full ${expired ? 'bg-slag' : 'bg-ore'} opacity-70`} />

      <div className="space-y-3 p-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted">
              {expired ? t.liveEvent.closed : t.liveEvent.closesIn}
            </p>
            <p
              className={`font-mono text-2xl tabular-nums ${expired ? 'text-slag' : 'text-ore'}`}
              // The clock changes every second; announcing it would be noise.
              aria-live="off"
            >
              {formatRemaining(remaining)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted">
              {t.liveEvent.worth}
            </p>
            <p className="font-mono text-2xl tabular-nums text-refined">+{event.pointsValue}</p>
          </div>
        </div>

        <p className="text-[11px] leading-relaxed text-muted">
          {t.redeem.pendingPrefix} {event.registrationCount}/{event.minParticipants}{' '}
          {t.liveEvent.quorumNote}
        </p>

        {registered ? (
          <FormMessage
            state={state}
            success={
              state?.ok ? (
                <>
                  <strong className="font-semibold">
                    +{state.data.pointsAwarded} {t.redeem.awarded}
                  </strong>{' '}
                  {t.redeem.for} {state.data.eventName}.
                </>
              ) : null
            }
          />
        ) : characters.length === 0 ? (
          <p className="text-xs text-muted">{t.redeem.needCharacter}</p>
        ) : (
          <form action={formAction} className="space-y-2">
            {characters.length > 1 && (
              <Select name="characterId" required className="text-xs">
                {characters.map((character) => (
                  <option key={character.id} value={character.id}>
                    {character.name} — {character.kind}
                  </option>
                ))}
              </Select>
            )}
            {characters.length === 1 && (
              <input type="hidden" name="characterId" value={characters[0]?.id} />
            )}

            <div className="flex gap-2">
              <Input
                name="code"
                required
                autoComplete="off"
                spellCheck={false}
                disabled={expired}
                placeholder={t.liveEvent.codePlaceholder}
                className="font-mono uppercase tracking-[0.2em]"
              />
              <SubmitButton>{t.liveEvent.redeem}</SubmitButton>
            </div>

            <FormMessage state={state} />
          </form>
        )}
      </div>
    </aside>
  )
}

/** hh:mm:ss, dropping the hours when there are none. Dashes until mounted. */
function formatRemaining(ms: number | null): string {
  if (ms === null) return '--:--'

  const total = Math.floor(ms / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}
