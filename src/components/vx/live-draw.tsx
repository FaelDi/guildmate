'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useDictionary } from '@/components/locale-provider'
import { fill } from './format'
import { Modal } from './modal'
import { Roulette, type RouletteSlice } from './roulette'

/**
 * Draws this tab already showed. Module scope, so it survives the router
 * refresh that follows the admin's own draw - the admin is not shown their
 * own wheel twice.
 */
const seen = new Set<string>()

export function markDrawSeen(itemId: string): void {
  seen.add(itemId)
}

type LiveDraw = {
  id: string
  itemName: string
  wheel: { slices: RouletteSlice[]; winnerIndex: number } | null
  winnerName: string | null
}

const POLL_MS = 4000

/**
 * Every signed-in screen polls for a fresh draw and replays the persisted
 * wheel - the "live raffle" the whole guild watches together.
 */
export function LiveDrawWatcher() {
  const t = useDictionary().vx
  const router = useRouter()
  const [draw, setDraw] = useState<LiveDraw | null>(null)
  const [finished, setFinished] = useState(false)

  useEffect(() => {
    let stopped = false

    async function poll() {
      if (document.hidden) return
      try {
        const response = await fetch('/api/loot/live', { cache: 'no-store' })
        if (!response.ok) return
        const body = (await response.json()) as { draw: LiveDraw | null }
        const next = body.draw
        if (!stopped && next && next.wheel && !seen.has(next.id)) {
          seen.add(next.id)
          setFinished(false)
          setDraw(next)
        }
      } catch {
        // A missed poll just means the next one catches up.
      }
    }

    void poll()
    const timer = setInterval(poll, POLL_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [])

  if (!draw?.wheel) return null

  return (
    <Modal
      open
      locked={!finished}
      width={560}
      zIndex={125}
      onClose={() => {
        setDraw(null)
        router.refresh()
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <h2 style={{ color: 'var(--neon-orange)', fontSize: 26 }}>
          {fill(t.drawing, { item: draw.itemName.toUpperCase() })}
        </h2>
        <Roulette
          slices={draw.wheel.slices}
          winnerIndex={draw.wheel.winnerIndex}
          onDone={() => setFinished(true)}
        />
        {finished && (
          <>
            <h3 style={{ color: 'var(--neon-green)', fontSize: 32, textShadow: '0 0 20px rgba(0,255,102,0.8)' }}>
              {fill(t.wins, { name: draw.winnerName ?? '' })}
            </h3>
            <button
              type="button"
              className="btn btn-success"
              onClick={() => {
                setDraw(null)
                router.refresh()
              }}
            >
              {t.drawClose}
            </button>
          </>
        )}
      </div>
    </Modal>
  )
}
