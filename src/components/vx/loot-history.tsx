'use client'

import { useState } from 'react'
import { updateLootNoteAction } from '@/app/actions/vortex'
import { useDictionary } from '@/components/locale-provider'
import { formatBrt } from './format'
import { Pagination, usePage } from './pagination'
import { useActionRunner } from './use-action'

export type LootHistoryRow = {
  id: string
  name: string
  winnerName: string | null
  staffWon: boolean
  pointsPaid: number
  drawnAt: string | null
  weekNumber: number | null
  note: string | null
}

/** "Registro de Espolios Concedidos". */
export function LootHistory({ rows, isAdmin }: { rows: LootHistoryRow[]; isAdmin: boolean }) {
  const t = useDictionary().vx
  const { slice, page, total, setPage } = usePage(rows)

  return (
    <div className="table-container" style={{ borderLeftColor: 'var(--neon-orange)' }}>
      <h2 style={{ color: 'var(--neon-orange)', textShadow: '0 0 12px rgba(255, 170, 0, 0.4)' }}>{t.lootTitle}</h2>
      <table>
        <thead>
          <tr>
            <th className="left">{t.lootHead.cycle}</th>
            <th className="left">{t.lootHead.receiver}</th>
            <th>{t.lootHead.item}</th>
            <th>{t.lootHead.deduction}</th>
            <th>{t.lootHead.note}</th>
          </tr>
        </thead>
        <tbody>
          {slice.length === 0 && (
            <tr>
              <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 50, fontSize: 20 }}>
                {t.empty}
              </td>
            </tr>
          )}
          {slice.map((row) => (
            <tr key={row.id}>
              <td className="left" style={{ color: 'var(--text-muted)' }}>
                {t.week} {row.weekNumber ?? 1}
                <div style={{ fontSize: 14 }}>{row.drawnAt ? formatBrt(row.drawnAt) : ''}</div>
              </td>
              <td className="left" style={{ fontWeight: 700, color: row.staffWon ? 'var(--neon-red)' : 'var(--neon-orange)' }}>
                {row.winnerName ?? t.none}
                {row.staffWon && <span style={{ fontSize: 14, marginLeft: 6 }}>({t.staffWon})</span>}
              </td>
              <td style={{ color: '#fff', fontWeight: 700 }}>{row.name}</td>
              <td style={{ color: 'var(--neon-red)', fontWeight: 700 }}>
                {row.pointsPaid > 0 ? `−${row.pointsPaid} ${t.pts}` : t.none}
              </td>
              <td style={{ minWidth: 220 }}>
                {isAdmin ? <NoteEditor itemId={row.id} note={row.note} /> : (row.note ?? t.none)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pagination page={page} total={total} setPage={setPage} />
    </div>
  )
}

function NoteEditor({ itemId, note }: { itemId: string; note: string | null }) {
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
        onClick={() => run(() => updateLootNoteAction({ itemId, note: value }), t.noteSaved)}
      >
        {t.saveNote}
      </button>
    </div>
  )
}
