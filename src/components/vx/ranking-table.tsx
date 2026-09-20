'use client'

import Link from 'next/link'
import { Fragment, useState } from 'react'
import { applyPenaltyAction, excuseAbsenceAction } from '@/app/actions/vortex'
import { useDictionary } from '@/components/locale-provider'
import { classifyCombatPower, type BuildFlags, type CpTier } from '@/lib/rules'
import { CharacterEditModal, type EditableCharacter } from './character-edit'
import { formatNumber, formatPct } from './format'
import { Modal } from './modal'
import { useActionRunner } from './use-action'

/** What only a signed-in member sees: the roster's own numbers. */
export type RankingDetails = {
  alts: string[]
  level: number
  combatPower: number
  biosuit: string
  build: BuildFlags
}

export type RankingRow = {
  mainId: string
  userId: string
  name: string
  participation: number
  penalties: number
  balance: number
  /** Null for a visitor who is not signed in. */
  details: RankingDetails | null
}

/**
 * "Modulo de Jogadores". Public: anyone reads the standings. What a visitor
 * does not get is the roster's detail - alts, level and combat power - which
 * is what a rival would scout. Mega and Titan members get a highlighted copy
 * at the top, like the original board, and everybody keeps their real rank
 * below.
 */
export function RankingTable({
  rows,
  meId,
  isAdmin,
  thresholds,
}: {
  rows: RankingRow[]
  /** Null when nobody is signed in. */
  meId: string | null
  isAdmin: boolean
  thresholds: { megaCpThreshold: number; titanCpThreshold: number }
}) {
  const t = useDictionary().vx
  const { run, pending } = useActionRunner()
  const [editing, setEditing] = useState<EditableCharacter | null>(null)
  const [excuseFor, setExcuseFor] = useState<RankingRow | null>(null)
  const [penaltyFor, setPenaltyFor] = useState<RankingRow | null>(null)
  const [amount, setAmount] = useState('1')
  const [reason, setReason] = useState('')

  const tiered = rows.map((row, index) => ({
    row,
    rank: index + 1,
    tier: row.details ? classifyCombatPower(row.details.combatPower, thresholds) : ('NONE' as CpTier),
  }))
  const megas = tiered
    .filter((r) => r.tier === 'MEGA')
    .sort((a, b) => (b.row.details?.combatPower ?? 0) - (a.row.details?.combatPower ?? 0))
  const titans = tiered
    .filter((r) => r.tier === 'TITAN')
    .sort((a, b) => (b.row.details?.combatPower ?? 0) - (a.row.details?.combatPower ?? 0))
  const columns = isAdmin ? 10 : 9

  const locked = (
    <span title={t.restrictedCell} style={{ color: 'var(--text-muted)' }}>
      🔒
    </span>
  )

  function renderRow(entry: (typeof tiered)[number], clone: boolean) {
    const { row, rank, tier } = entry
    const mine = meId !== null && row.userId === meId
    const glow = tier === 'MEGA' ? 'mega' : tier === 'TITAN' ? 'tita' : ''
    const rowClass = glow ? (clone ? `${glow}-clone` : `${glow}-glow`) : ''
    const rankLabel = clone ? (tier === 'MEGA' ? '⭐' : '⚔️') : rank
    const details = row.details

    return (
      <tr key={`${clone ? 'c' : 'r'}-${row.mainId}`} className={rowClass}>
        <td style={{ color: 'var(--text-muted)', fontWeight: 'bold', fontSize: 20 }}>{rankLabel}</td>
        <td className="left">
          <span
            style={{
              fontWeight: 700,
              fontSize: 22,
              color: mine ? 'var(--neon-green)' : tierColor(tier),
              textShadow: '0 0 15px rgba(255,255,255,0.3)',
            }}
          >
            {row.name}
          </span>
        </td>
        <td className="left" style={{ color: 'var(--text-muted)', fontSize: 16 }}>
          {details ? (details.alts.length > 0 ? details.alts.join(', ') : t.none) : locked}
        </td>
        <td>
          {details ? <span style={{ color: '#fff', fontSize: 20 }}>{details.level}</span> : locked}
        </td>
        <td>
          {details ? (
            <span
              style={{
                color: 'var(--neon-cyan)',
                fontFamily: 'var(--font-mono)',
                fontSize: 18,
                fontWeight: 'bold',
              }}
            >
              {formatNumber(details.combatPower)}
            </span>
          ) : (
            <span title={t.restrictedCell} style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {t.restricted}
            </span>
          )}
        </td>
        <td
          style={{
            fontWeight: 'bold',
            fontSize: 22,
            color: participationColor(row.participation),
          }}
        >
          {formatPct(row.participation)}
        </td>
        <td style={{ color: 'var(--neon-red)', fontWeight: 'bold', fontSize: 22 }}>{row.penalties}</td>
        <td
          style={{
            color: 'var(--neon-green)',
            fontWeight: 700,
            fontSize: 26,
            textShadow: '0 0 15px rgba(0,255,102,0.4)',
          }}
        >
          {row.balance} {t.pts}
        </td>
        <td>
          {details && (mine || isAdmin) && !clone ? (
            <button
              type="button"
              className="btn btn-outline btn-sm"
              style={{ borderColor: 'var(--neon-cyan)', color: 'var(--neon-cyan)' }}
              onClick={() =>
                setEditing({
                  id: row.mainId,
                  name: row.name,
                  biosuit: details.biosuit,
                  level: details.level,
                  combatPower: details.combatPower,
                  build: details.build,
                })
              }
            >
              {t.edit}
            </button>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>{mine ? '' : '🔒'}</span>
          )}
        </td>
        {isAdmin && (
          <td>
            {!clone && row.userId !== meId && (
              <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                <button
                  type="button"
                  className="btn btn-success btn-sm"
                  onClick={() => {
                    setExcuseFor(row)
                    setAmount('1')
                    setReason(t.excuseDefault)
                  }}
                >
                  {t.excuse}
                </button>
                <button
                  type="button"
                  className="btn btn-red btn-sm"
                  onClick={() => {
                    setPenaltyFor(row)
                    setAmount('1')
                    setReason('')
                  }}
                >
                  {t.penalty}
                </button>
              </div>
            )}
          </td>
        )}
      </tr>
    )
  }

  return (
    <>
      <table>
        <thead>
          <tr>
            <th style={{ width: 50 }}>{t.rankingHead.rank}</th>
            <th className="left">{t.rankingHead.player}</th>
            <th className="left">{t.rankingHead.alts}</th>
            <th style={{ width: 80 }}>{t.rankingHead.level}</th>
            <th style={{ width: 120 }}>{t.rankingHead.power}</th>
            <th style={{ color: '#fff' }}>{t.rankingHead.participation}</th>
            <th style={{ color: 'var(--neon-red)', textShadow: '0 0 5px var(--neon-red)' }}>
              {t.rankingHead.penalties}
            </th>
            <th style={{ fontSize: 18, color: 'var(--neon-green)' }}>{t.rankingHead.balance}</th>
            <th style={{ width: 90 }}>{t.rankingHead.edit}</th>
            {isAdmin && <th>{t.rankingHead.admin}</th>}
          </tr>
        </thead>
        <tbody>
          {megas.length > 0 && (
            <Fragment>
              <tr className="linha-tier">
                <td colSpan={columns} style={{ color: 'var(--gold-mega)' }}>
                  {t.megaTier}
                </td>
              </tr>
              {megas.map((entry) => renderRow(entry, true))}
            </Fragment>
          )}
          {titans.length > 0 && (
            <Fragment>
              <tr className="linha-tier">
                <td colSpan={columns} style={{ color: 'var(--blue-tita)' }}>
                  {t.titanTier}
                </td>
              </tr>
              {titans.map((entry) => renderRow(entry, true))}
            </Fragment>
          )}
          {tiered.length === 0 ? (
            <tr>
              <td colSpan={columns} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 50 }}>
                {t.empty}
              </td>
            </tr>
          ) : (
            tiered.map((entry) => renderRow(entry, false))
          )}
        </tbody>
      </table>

      <CharacterEditModal
        character={editing}
        isAdmin={isAdmin}
        mode="stats"
        onClose={() => setEditing(null)}
        footer={
          editing && rows.find((r) => r.mainId === editing.id)?.userId === meId ? (
            <Link href="/profile" style={{ color: 'var(--neon-cyan)', fontSize: 15 }}>
              {t.manageAlts}
            </Link>
          ) : null
        }
      />

      <Modal open={excuseFor !== null} onClose={() => setExcuseFor(null)} width={480} borderColor="var(--neon-green)">
        <h2 style={{ color: 'var(--neon-green)' }}>
          {t.excuseTitle}: {excuseFor?.name}
        </h2>
        <label className="field-label">{t.excuseEvents}</label>
        <input
          className="input-edit"
          type="number"
          min={1}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={{ width: '100%' }}
        />
        <label className="field-label">{t.excuseReason}</label>
        <input
          className="input-edit"
          value={reason}
          maxLength={200}
          onChange={(e) => setReason(e.target.value)}
          style={{ width: '100%', textAlign: 'left' }}
        />
        <div className="modal-actions">
          <button type="button" className="btn btn-muted" onClick={() => setExcuseFor(null)}>
            {t.cancel}
          </button>
          <button
            type="button"
            className="btn btn-success"
            disabled={pending}
            onClick={async () => {
              if (!excuseFor) return
              const result = await run(
                () =>
                  excuseAbsenceAction({
                    userId: excuseFor.userId,
                    eventsExcused: Number(amount) || 0,
                    reason,
                  }),
                t.excuseDone,
              )
              if (result.ok) setExcuseFor(null)
            }}
          >
            {pending ? t.processing : t.confirm}
          </button>
        </div>
      </Modal>

      <Modal open={penaltyFor !== null} onClose={() => setPenaltyFor(null)} width={480} borderColor="var(--neon-red)">
        <h2 style={{ color: 'var(--neon-red)' }}>
          {t.penaltyTitle}: {penaltyFor?.name}
        </h2>
        <label className="field-label">{t.penaltyPoints}</label>
        <input
          className="input-edit"
          type="number"
          min={1}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={{ width: '100%' }}
        />
        <label className="field-label">{t.penaltyReason}</label>
        <input
          className="input-edit"
          value={reason}
          maxLength={200}
          onChange={(e) => setReason(e.target.value)}
          style={{ width: '100%', textAlign: 'left' }}
        />
        <div className="modal-actions">
          <button type="button" className="btn btn-muted" onClick={() => setPenaltyFor(null)}>
            {t.cancel}
          </button>
          <button
            type="button"
            className="btn btn-red"
            disabled={pending}
            onClick={async () => {
              if (!penaltyFor) return
              const result = await run(
                () =>
                  applyPenaltyAction({
                    userId: penaltyFor.userId,
                    points: Number(amount) || 0,
                    reason,
                  }),
                t.penaltyDone,
              )
              if (result.ok) setPenaltyFor(null)
            }}
          >
            {pending ? t.processing : t.confirm}
          </button>
        </div>
      </Modal>
    </>
  )
}

function tierColor(tier: CpTier): string {
  if (tier === 'MEGA') return 'var(--gold-mega)'
  if (tier === 'TITAN') return 'var(--blue-tita)'
  return 'var(--neon-orange)'
}

function participationColor(pct: number): string {
  if (pct >= 90) return 'var(--neon-green)'
  if (pct >= 50) return 'var(--neon-orange)'
  return 'var(--neon-red)'
}
