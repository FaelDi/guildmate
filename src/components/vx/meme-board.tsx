'use client'

import { useEffect, useRef, useState } from 'react'
import { deleteMemeDrawAction, drawMemeAction, updateMemeNoteAction } from '@/app/actions/vortex'
import { useDictionary } from '@/components/locale-provider'
import { fill, formatBrt } from './format'
import { Modal } from './modal'
import { Pagination, usePage } from './pagination'
import { useToast } from './toast'
import { useActionRunner } from './use-action'

export type MemeRow = { id: string; itemName: string; winnerName: string; note: string | null; createdAt: string }
export type MemeCandidate = { id: string; name: string }

/** "Sorteio Items Meme": a points-free raffle, admins draw, everyone sees history. */
export function MemeBoard({
  rows,
  candidates,
  isAdmin,
}: {
  rows: MemeRow[]
  candidates: MemeCandidate[]
  isAdmin: boolean
}) {
  const t = useDictionary().vx
  const toast = useToast()
  const { run, pending } = useActionRunner()
  const { slice, page, total, setPage } = usePage(rows)
  const [item, setItem] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [spin, setSpin] = useState<{ item: string; names: string[]; winner: string | null } | null>(null)
  const [tick, setTick] = useState(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current)
  }, [])

  async function draw() {
    if (!item.trim()) return toast(t.memeNeedItem, 'aviso')
    if (picked.size === 0) return toast(t.memeNeedTargets, 'aviso')

    const names = candidates.filter((c) => picked.has(c.id)).map((c) => c.name)
    setSpin({ item: item.trim(), names, winner: null })
    if (timer.current) clearInterval(timer.current)
    timer.current = setInterval(() => setTick((n) => n + 1), 50)

    const result = await run(() => drawMemeAction({ itemName: item, characterIds: [...picked] }))
    if (!result.ok) {
      if (timer.current) clearInterval(timer.current)
      setSpin(null)
      return
    }
    setTimeout(() => {
      if (timer.current) clearInterval(timer.current)
      setSpin((current) => (current ? { ...current, winner: result.data.winnerName } : null))
      setItem('')
    }, 2500)
  }

  return (
    <>
      {isAdmin && (
        <div className="table-container" style={{ borderLeftColor: 'var(--neon-orange)' }}>
          <h2 style={{ color: 'var(--neon-orange)', textShadow: '0 0 12px rgba(255,170,0,0.4)' }}>{t.memeDrawTitle}</h2>
          <label className="field-label">{t.memeItem}</label>
          <input
            className="input-edit"
            value={item}
            maxLength={120}
            onChange={(e) => setItem(e.target.value)}
            style={{ width: '100%', maxWidth: 500, textAlign: 'left' }}
          />
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '15px 0', fontSize: 16 }}>
            <input
              type="checkbox"
              checked={picked.size === candidates.length && candidates.length > 0}
              onChange={(e) => setPicked(e.target.checked ? new Set(candidates.map((c) => c.id)) : new Set())}
              style={{ accentColor: 'var(--neon-cyan)' }}
            />
            {t.memeSelectAll}
          </label>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
              gap: 8,
              marginBottom: 15,
            }}
          >
            {candidates.map((c) => (
              <label
                key={c.id}
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  background: 'rgba(0,0,0,0.3)',
                  padding: 8,
                  borderRadius: 4,
                  border: `1px solid ${picked.has(c.id) ? 'var(--neon-cyan)' : 'rgba(255,255,255,0.1)'}`,
                  fontSize: 15,
                }}
              >
                <input
                  type="checkbox"
                  checked={picked.has(c.id)}
                  onChange={(e) =>
                    setPicked((current) => {
                      const next = new Set(current)
                      if (e.target.checked) next.add(c.id)
                      else next.delete(c.id)
                      return next
                    })
                  }
                  style={{ accentColor: 'var(--neon-cyan)' }}
                />
                {c.name}
              </label>
            ))}
          </div>
          <button type="button" className="btn btn-warning" disabled={pending || spin !== null} onClick={draw}>
            {t.memeSpin}
          </button>
        </div>
      )}

      <div className="table-container" style={{ borderLeftColor: 'var(--neon-cyan)' }}>
        <h2 style={{ color: 'var(--neon-cyan)', textShadow: '0 0 12px rgba(0, 243, 255, 0.4)' }}>{t.memeTitle}</h2>
        <table>
          <thead>
            <tr>
              <th className="left">{t.memeHead.date}</th>
              <th className="left">{t.memeHead.winner}</th>
              <th>{t.memeHead.item}</th>
              <th>{t.memeHead.note}</th>
              {isAdmin && <th style={{ width: 60 }} />}
            </tr>
          </thead>
          <tbody>
            {slice.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 50, fontSize: 20 }}>
                  {t.memeEmpty}
                </td>
              </tr>
            )}
            {slice.map((row) => (
              <tr key={row.id}>
                <td className="left" style={{ color: 'var(--text-muted)' }}>{formatBrt(row.createdAt)}</td>
                <td className="left" style={{ fontWeight: 700, color: 'var(--neon-cyan)' }}>{row.winnerName}</td>
                <td style={{ color: '#fff', fontWeight: 700 }}>{row.itemName}</td>
                <td style={{ minWidth: 220 }}>
                  {isAdmin ? <MemeNote id={row.id} note={row.note} /> : (row.note ?? t.none)}
                </td>
                {isAdmin && (
                  <td>
                    <button
                      type="button"
                      className="btn-danger"
                      disabled={pending}
                      onClick={() => {
                        if (window.confirm(t.memeDelete)) run(() => deleteMemeDrawAction({ id: row.id }), t.memeDeleted)
                      }}
                    >
                      ✖
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page} total={total} setPage={setPage} />
      </div>

      <Modal open={spin !== null} onClose={() => setSpin(null)} locked={spin?.winner === null} width={560}>
        {spin && (
          <div style={{ textAlign: 'center' }}>
            <h2 style={{ color: 'var(--neon-cyan)' }}>{fill(t.memeDrawing, { item: spin.item.toUpperCase() })}</h2>
            <div
              className="roleta-box"
              style={spin.winner ? { color: 'var(--neon-cyan)', textShadow: '0 0 20px rgba(0,243,255,0.8)' } : undefined}
            >
              {spin.winner ? fill(t.wins, { name: spin.winner }) : (spin.names[tick % Math.max(1, spin.names.length)] ?? '')}
            </div>
            {spin.winner && (
              <button type="button" className="btn btn-success" onClick={() => setSpin(null)}>
                {t.close}
              </button>
            )}
          </div>
        )}
      </Modal>
    </>
  )
}

function MemeNote({ id, note }: { id: string; note: string | null }) {
  const t = useDictionary().vx
  const { run, pending } = useActionRunner()
  const [value, setValue] = useState(note ?? '')
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <input
        className="input-edit"
        value={value}
        maxLength={200}
        onChange={(e) => setValue(e.target.value)}
        style={{ flex: 1, fontSize: 14, textAlign: 'left' }}
      />
      <button
        type="button"
        className="btn btn-sm"
        disabled={pending || value === (note ?? '')}
        onClick={() => run(() => updateMemeNoteAction({ id, note: value }), t.noteSaved)}
      >
        {t.saveNote}
      </button>
    </div>
  )
}
