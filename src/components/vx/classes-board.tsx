'use client'

import { useMemo, useState } from 'react'
import { useDictionary } from '@/components/locale-provider'
import { classifyCombatPower } from '@/lib/rules'
import { BUILD_KEYS, CharacterEditModal, type EditableCharacter } from './character-edit'
import { CLASSES, formatNumber } from './format'

export type ClassRow = EditableCharacter & { userId: string }

const BUILD_COLORS: Record<string, string> = {
  skill4: '#ffaa00',
  skill5: '#ffaa00',
  skill6: '#ffaa00',
  skill7: '#ffaa00',
  constant3: '#00ff66',
  painAdaptation: '#00ff66',
  trinity: '#bc13fe',
  techniqueMaster: '#00f3ff',
}

/** "Ordem de Classes & Builds": combat-power order with the build checklist. */
export function ClassesBoard({
  rows,
  meId,
  isAdmin,
  thresholds,
}: {
  rows: ClassRow[]
  meId: string
  isAdmin: boolean
  thresholds: { megaCpThreshold: number; titanCpThreshold: number }
}) {
  const t = useDictionary().vx
  const [filter, setFilter] = useState('ALL')
  const [editing, setEditing] = useState<EditableCharacter | null>(null)

  const visible = useMemo(
    () => (filter === 'ALL' ? rows : rows.filter((r) => r.biosuit === filter)),
    [rows, filter],
  )

  const highlights = rows
    .map((row) => ({ row, tier: classifyCombatPower(row.combatPower, thresholds) }))
    .filter((h) => h.tier !== 'NONE')

  return (
    <div className="table-container" style={{ borderLeftColor: 'var(--neon-cyan)', paddingBottom: 0 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
          flexWrap: 'wrap',
          gap: 15,
        }}
      >
        <h2 style={{ color: 'var(--neon-cyan)', textShadow: '0 0 12px rgba(0, 243, 255, 0.4)', margin: 0 }}>
          {t.classesTitle}
        </h2>
        <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
          <label style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>{t.classFilter}</label>
          <select
            className="input-edit"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ width: 200, textAlign: 'left' }}
          >
            <option value="ALL">{t.allClasses}</option>
            {CLASSES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      {filter === 'ALL' && highlights.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', marginBottom: 15 }}>
          {highlights.map(({ row, tier }) => (
            <div key={row.id} className={`banner-destaque ${tier === 'MEGA' ? 'banner-mega' : 'banner-tita'}`}>
              <div className="icone">{tier === 'MEGA' ? '⭐' : '⚔️'}</div>
              <div>
                <div className="nome">{row.name}</div>
                <div className="classe">{row.biosuit || t.noClass}</div>
                <div className="cp">{formatNumber(row.combatPower)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="table-scroll-fixed">
        <table>
          <thead>
            <tr>
              <th style={{ width: 50 }}>{t.classesHead.rank}</th>
              <th className="left">{t.classesHead.member}</th>
              <th>{t.classesHead.class}</th>
              {BUILD_KEYS.map((key) => (
                <th key={key} title={t.build[key]} style={{ width: 55, color: BUILD_COLORS[key] }}>
                  {t.buildShort[key]}
                </th>
              ))}
              <th>{t.classesHead.power}</th>
              <th style={{ width: 90 }}>{t.classesHead.edit}</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={13} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 50 }}>
                  {t.empty}
                </td>
              </tr>
            )}
            {visible.map((row, index) => {
              const tier = classifyCombatPower(row.combatPower, thresholds)
              const glow = tier === 'MEGA' ? 'mega-glow' : tier === 'TITAN' ? 'tita-glow' : ''
              const mine = row.userId === meId
              return (
                <tr key={row.id} className={glow}>
                  <td style={{ color: 'var(--text-muted)', fontWeight: 'bold', fontSize: 20 }}>{index + 1}</td>
                  <td
                    className="left"
                    style={{ fontWeight: 700, fontSize: 20, color: mine ? 'var(--neon-green)' : '#fff' }}
                  >
                    {row.name}
                  </td>
                  <td>
                    <span style={{ color: 'var(--neon-cyan)', fontWeight: 'bold', fontSize: 18 }}>
                      {row.biosuit || t.noClass}
                    </span>
                  </td>
                  {BUILD_KEYS.map((key) => (
                    <td key={key} style={{ color: BUILD_COLORS[key], fontWeight: 'bold', fontSize: 22 }}>
                      {row.build[key] ? '✓' : '-'}
                    </td>
                  ))}
                  <td
                    style={{
                      color: 'var(--neon-green)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 20,
                      fontWeight: 'bold',
                    }}
                  >
                    {formatNumber(row.combatPower)}
                  </td>
                  <td>
                    {mine || isAdmin ? (
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        style={{ borderColor: 'var(--neon-cyan)', color: 'var(--neon-cyan)' }}
                        onClick={() => setEditing(row)}
                      >
                        {t.edit}
                      </button>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>🔒</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <CharacterEditModal character={editing} isAdmin={isAdmin} mode="build" onClose={() => setEditing(null)} />
    </div>
  )
}
