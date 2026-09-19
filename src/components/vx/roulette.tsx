'use client'

import { useEffect, useRef, useState } from 'react'

export type RouletteSlice = { label: string; weight: number; kind: 'STAFF' | 'BET' }

const COLORS = ['#00f3ff', '#bc13fe', '#00ff66', '#ffaa00', '#00a8ff', '#ff4fd8', '#9dff00', '#ff7a00']
const STAFF_COLOR = '#ff003c'
const SPIN_MS = 6500
const SIZE = 400

/**
 * The wheel. It does not choose anything: the server already drew the winner
 * and persisted the wheel, and this only animates the slices so the pointer
 * lands on `winnerIndex`. Every viewer gets the same wheel and the same stop.
 */
export function Roulette({
  slices,
  winnerIndex,
  onDone,
}: {
  slices: RouletteSlice[]
  winnerIndex: number
  onDone: () => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [rotation, setRotation] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const done = useRef(onDone)
  done.current = onDone

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    const r = SIZE / 2
    ctx.clearRect(0, 0, SIZE, SIZE)

    let start = -Math.PI / 2
    slices.forEach((slice, i) => {
      const angle = slice.weight * Math.PI * 2
      ctx.beginPath()
      ctx.moveTo(r, r)
      ctx.arc(r, r, r, start, start + angle)
      ctx.closePath()
      ctx.fillStyle = slice.kind === 'STAFF' ? STAFF_COLOR : (COLORS[i % COLORS.length] ?? '#00f3ff')
      ctx.globalAlpha = 0.85
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.strokeStyle = '#0a0a0f'
      ctx.lineWidth = 2
      ctx.stroke()

      if (angle > 0.12) {
        ctx.save()
        ctx.translate(r, r)
        ctx.rotate(start + angle / 2)
        ctx.textAlign = 'right'
        ctx.fillStyle = '#000'
        ctx.font = 'bold 16px Rajdhani, sans-serif'
        const text = slice.label.length > 16 ? `${slice.label.slice(0, 15)}…` : slice.label
        ctx.fillText(text, r - 14, 6)
        ctx.restore()
      }
      start += angle
    })
  }, [slices])

  useEffect(() => {
    // The winner's slice spans [from, to] degrees clockwise from the top.
    let from = 0
    for (let i = 0; i < winnerIndex; i++) from += (slices[i]?.weight ?? 0) * 360
    const width = (slices[winnerIndex]?.weight ?? 0) * 360
    // Land somewhere inside the slice, never on its edge. The offset is cosmetic.
    const target = from + width * (0.2 + Math.random() * 0.6)
    const final = 360 * 6 + (360 - target)

    const kick = setTimeout(() => {
      setSpinning(true)
      setRotation(final)
    }, 60)
    const finish = setTimeout(() => done.current(), SPIN_MS + 200)
    return () => {
      clearTimeout(kick)
      clearTimeout(finish)
    }
  }, [slices, winnerIndex])

  return (
    <div className="roleta-container">
      <div className="roleta-ponteiro" />
      <div
        className="roleta-canvas-wrapper"
        style={{
          transform: `rotate(${rotation}deg)`,
          transition: spinning ? `transform ${SPIN_MS}ms cubic-bezier(0.15, 0.85, 0.2, 1)` : 'none',
        }}
      >
        <canvas ref={canvas} width={SIZE} height={SIZE} />
      </div>
    </div>
  )
}
