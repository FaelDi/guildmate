'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import {
  closeBannerAction,
  drawItemAction,
  extendBannerAction,
  placeBetAction,
  withdrawBetAction,
} from '@/app/actions/vortex'
import { useDictionary } from '@/components/locale-provider'
import { buildLootWheel } from '@/lib/rules'
import { fill, formatPct, pad2, splitDuration } from './format'
import { markDrawSeen } from './live-draw'
import { Modal } from './modal'
import { Roulette, type RouletteSlice } from './roulette'
import { useActionRunner } from './use-action'

export type BannerItemView = {
  id: string
  name: string
  maxPoints: number
  restriction: 'ALL' | 'TITAN' | 'MEGA'
  status: 'OPEN' | 'DRAWN' | 'CANCELLED'
  winnerName: string | null
  pointsPaid: number
  bets: { id: string; userId: string; characterName: string; points: number }[]
}

export type BannerView = {
  id: string
  title: string
  closesAtMs: number | null
  items: BannerItemView[]
}

type Me = {
  userId: string
  isAdmin: boolean
  mainName: string | null
  balance: number
  participation: number
}

type Settings = { staffSharePct: number; minParticipationPct: number }

function useCountdown(closesAtMs: number | null) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (closesAtMs === null) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [closesAtMs])
  return closesAtMs === null ? null : closesAtMs - now
}

/** The live loot banner, shown above the tabs while a banner is open. */
export function LootBanner({
  banner,
  me,
  settings,
  staff,
}: {
  banner: BannerView
  /** Null for a visitor who is not signed in: the banner is read-only then. */
  me: Me | null
  settings: Settings
  staff: { userId: string; name: string }[]
}) {
  const t = useDictionary().vx
  const { run, pending } = useActionRunner()
  const remaining = useCountdown(banner.closesAtMs)
  const accepting = remaining === null || remaining > 0

  const [betItem, setBetItem] = useState<BannerItemView | null>(null)
  const [betPoints, setBetPoints] = useState('')
  const [drawTarget, setDrawTarget] = useState<BannerItemView | null>(null)
  const [staffPick, setStaffPick] = useState<string>(staff[0]?.userId ?? '')
  const [wheel, setWheel] = useState<{
    item: string
    slices: RouletteSlice[]
    winnerIndex: number
    winner: string
  } | null>(null)
  const [wheelDone, setWheelDone] = useState(false)
  const [extendOpen, setExtendOpen] = useState(false)
  const [extendHours, setExtendHours] = useState('1')
  const [tutorialOpen, setTutorialOpen] = useState(false)

  let timerText = t.noDeadline
  if (remaining !== null) {
    if (remaining <= 0) timerText = t.timeUp
    else {
      const d = splitDuration(remaining)
      timerText = `${pad2(d.days * 24 + d.hours)}:${pad2(d.minutes)}:${pad2(d.seconds)}`
    }
  }

  const rest = 100 - settings.staffSharePct

  async function confirmBet() {
    if (!betItem) return
    const points = Number(betPoints)
    if (!Number.isInteger(points) || points <= 0) return
    if (!window.confirm(fill(t.betConfirm, { n: points }))) return
    const result = await run(() => placeBetAction({ itemId: betItem.id, points }), t.betPlaced)
    if (result.ok) {
      setBetItem(null)
      setBetPoints('')
    }
  }

  async function confirmDraw() {
    if (!drawTarget) return
    const item = drawTarget
    const result = await run(() =>
      drawItemAction({ itemId: item.id, staffUserId: staffPick === '' ? null : staffPick }),
    )
    setDrawTarget(null)
    if (result.ok) {
      markDrawSeen(item.id)
      setWheelDone(false)
      setWheel({
        item: result.data.itemName,
        slices: result.data.slices.map((s) => ({ label: s.label, weight: s.weight, kind: s.kind })),
        winnerIndex: result.data.winnerIndex,
        winner: result.data.winnerLabel,
      })
    }
  }

  return (
    <div className="banner-evento">
      <h2>
        {t.bannerLive}: {banner.title}
      </h2>
      <div
        className="timer-display"
        suppressHydrationWarning
        style={{
          color: accepting ? undefined : 'var(--neon-red)',
          fontSize: remaining === null ? 26 : undefined,
        }}
      >
        {timerText}
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setTutorialOpen(true)}>
          {t.howItWorks}
        </button>
        {me === null && (
          <Link href="/login" className="btn btn-success btn-sm">
            🔒 {t.signInToBet}
          </Link>
        )}
        {me?.isAdmin && (
          <>
            {banner.closesAtMs !== null && (
              <button type="button" className="btn btn-warning btn-sm" onClick={() => setExtendOpen(true)}>
                {t.extend}
              </button>
            )}
            <button
              type="button"
              className="btn btn-red btn-sm"
              disabled={pending}
              onClick={() => {
                if (window.confirm(t.closeBannerConfirm)) {
                  run(() => closeBannerAction({ bannerId: banner.id }), t.bannerClosed)
                }
              }}
            >
              {t.closeBanner}
            </button>
          </>
        )}
      </div>

      {banner.items.map((item) => (
        <BannerItem
          key={item.id}
          item={item}
          me={me}
          staffSharePct={settings.staffSharePct}
          accepting={accepting}
          pending={pending}
          onBet={() => {
            setBetItem(item)
            setBetPoints('')
          }}
          onWithdraw={(betId) => {
            if (window.confirm(t.removeBetConfirm)) {
              run(() => withdrawBetAction({ betId }), t.betRemoved)
            }
          }}
          onDraw={() => setDrawTarget(item)}
        />
      ))}

      <Modal open={betItem !== null} onClose={() => setBetItem(null)} width={500} zIndex={110}>
        {betItem && (
          <>
            <h2 style={{ color: 'var(--neon-green)' }}>{t.betTitle}</h2>
            <p style={{ color: '#fff', fontSize: 22, fontWeight: 700 }}>{betItem.name}</p>
            <p style={{ color: 'var(--text-muted)' }}>
              {fill(t.betCap, { max: betItem.maxPoints, pct: settings.minParticipationPct })}
            </p>
            {me?.mainName ? (
              <>
                <label className="field-label">{t.betAs}</label>
                <p style={{ color: 'var(--neon-orange)', fontSize: 20, fontWeight: 700, margin: 0 }}>
                  {me.mainName}
                </p>
                <p style={{ color: 'var(--text-muted)' }}>
                  {fill(t.betBalance, {
                    n: me.balance,
                    pct: formatPct(me.participation).replace('%', ''),
                  })}
                </p>
                <label className="field-label">{t.betPoints}</label>
                <input
                  className="input-edit"
                  type="number"
                  min={1}
                  max={betItem.maxPoints}
                  value={betPoints}
                  onChange={(e) => setBetPoints(e.target.value)}
                  placeholder="Ex: 10"
                  style={{ width: '100%' }}
                />
              </>
            ) : (
              <p style={{ color: 'var(--neon-red)' }}>{t.needMain}</p>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-muted" onClick={() => setBetItem(null)}>
                {t.cancel}
              </button>
              <button
                type="button"
                className="btn btn-success"
                disabled={pending || !me?.mainName}
                onClick={confirmBet}
              >
                {pending ? t.processing : t.confirm}
              </button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={drawTarget !== null} onClose={() => setDrawTarget(null)} width={500} zIndex={115}>
        <h2 style={{ color: 'var(--neon-orange)' }}>{t.staffTitle}</h2>
        <p style={{ color: 'var(--text-muted)' }}>
          {fill(t.staffHint, { pct: settings.staffSharePct })}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left' }}>
          {staff.map((s) => (
            <label key={s.userId} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 18 }}>
              <input
                type="radio"
                name="staff"
                checked={staffPick === s.userId}
                onChange={() => setStaffPick(s.userId)}
                style={{ accentColor: 'var(--neon-orange)' }}
              />
              {s.name}
            </label>
          ))}
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 18 }}>
            <input
              type="radio"
              name="staff"
              checked={staffPick === ''}
              onChange={() => setStaffPick('')}
              style={{ accentColor: 'var(--neon-orange)' }}
            />
            {t.noStaff}
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-muted" onClick={() => setDrawTarget(null)}>
            {t.cancel}
          </button>
          <button type="button" className="btn btn-warning" disabled={pending} onClick={confirmDraw}>
            {pending ? t.processing : t.spin}
          </button>
        </div>
      </Modal>

      <Modal open={wheel !== null} onClose={() => setWheel(null)} locked={!wheelDone} width={560} zIndex={120}>
        {wheel && (
          <div style={{ textAlign: 'center' }}>
            <h2 style={{ color: 'var(--neon-orange)', fontSize: 26 }}>
              {fill(t.drawing, { item: wheel.item.toUpperCase() })}
            </h2>
            <Roulette slices={wheel.slices} winnerIndex={wheel.winnerIndex} onDone={() => setWheelDone(true)} />
            {wheelDone && (
              <>
                <h3 style={{ color: 'var(--neon-green)', fontSize: 32, textShadow: '0 0 20px rgba(0,255,102,0.8)' }}>
                  {fill(t.wins, { name: wheel.winner })}
                </h3>
                <button type="button" className="btn btn-success" onClick={() => setWheel(null)}>
                  {t.drawDone}
                </button>
              </>
            )}
          </div>
        )}
      </Modal>

      <Modal open={extendOpen} onClose={() => setExtendOpen(false)} width={420}>
        <h2>{t.extendTitle}</h2>
        <label className="field-label">{t.extendHours}</label>
        <select className="input-edit" value={extendHours} onChange={(e) => setExtendHours(e.target.value)} style={{ width: '100%' }}>
          {[1, 2, 3, 6, 12, 24, 48].map((h) => (
            <option key={h} value={h}>
              {fill(t.hours, { n: h })}
            </option>
          ))}
        </select>
        <div className="modal-actions">
          <button type="button" className="btn btn-muted" onClick={() => setExtendOpen(false)}>
            {t.cancel}
          </button>
          <button
            type="button"
            className="btn btn-warning"
            disabled={pending}
            onClick={async () => {
              const result = await run(
                () => extendBannerAction({ bannerId: banner.id, hours: Number(extendHours) }),
                t.extended,
              )
              if (result.ok) setExtendOpen(false)
            }}
          >
            {t.confirm}
          </button>
        </div>
      </Modal>

      <Modal open={tutorialOpen} onClose={() => setTutorialOpen(false)} zIndex={130}>
        <h2>{t.tutorialTitle}</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 16, textAlign: 'left' }}>{t.tutorialIntro}</p>
        <ul style={{ textAlign: 'left', fontSize: 16, lineHeight: 1.5, paddingLeft: 20 }}>
          {t.tutorial.map(([title, body]) => (
            <li key={title} style={{ marginBottom: 12 }}>
              <strong style={{ color: 'var(--neon-cyan)' }}>
                {fill(title ?? '', { pct: settings.minParticipationPct, staff: settings.staffSharePct, rest })}
              </strong>{' '}
              {fill(body ?? '', { pct: settings.minParticipationPct, staff: settings.staffSharePct, rest })}
            </li>
          ))}
        </ul>
        <div className="modal-actions" style={{ justifyContent: 'center' }}>
          <button type="button" className="btn btn-outline" onClick={() => setTutorialOpen(false)}>
            {t.understood}
          </button>
        </div>
      </Modal>
    </div>
  )
}

function BannerItem({
  item,
  me,
  staffSharePct,
  accepting,
  pending,
  onBet,
  onWithdraw,
  onDraw,
}: {
  item: BannerItemView
  me: Me | null
  staffSharePct: number
  accepting: boolean
  pending: boolean
  onBet: () => void
  onWithdraw: (betId: string) => void
  onDraw: () => void
}) {
  const t = useDictionary().vx
  const chances = useMemo(() => {
    const wheel = buildLootWheel({
      bets: item.bets.map((b) => ({ id: b.id, label: b.characterName, points: b.points })),
      staffLabel: 'staff',
      staffSharePct,
    })
    return new Map(wheel.filter((s) => s.betId).map((s) => [s.betId as string, s.weight * 100]))
  }, [item.bets, staffSharePct])

  const myBet = me ? item.bets.find((b) => b.userId === me.userId) : undefined
  const color =
    item.restriction === 'MEGA'
      ? 'var(--gold-mega)'
      : item.restriction === 'TITAN'
        ? 'var(--blue-tita)'
        : 'var(--neon-cyan)'

  return (
    <div className="item-card" style={{ borderLeftColor: color }}>
      <div style={{ flex: '1 1 260px' }}>
        <div style={{ color: '#fff', fontSize: 22, fontWeight: 700 }}>{item.name}</div>
        <div style={{ color, fontSize: 14, fontWeight: 700, letterSpacing: 1 }}>
          {t.restriction[item.restriction]} · {t.maxBet} {item.maxPoints} {t.pts}
        </div>
        {item.status === 'OPEN' ? (
          <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {item.bets.length === 0 && (
              <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>{t.noBetsYet}</span>
            )}
            {item.bets.map((bet) => (
              <span
                key={bet.id}
                style={{
                  background: 'rgba(0,0,0,0.5)',
                  border: `1px solid ${bet.userId === me?.userId ? 'var(--neon-green)' : 'var(--glass-border)'}`,
                  padding: '3px 8px',
                  borderRadius: 4,
                  fontSize: 14,
                }}
              >
                {bet.characterName}: <b style={{ color: 'var(--neon-green)' }}>{bet.points}</b>{' '}
                <span style={{ color: 'var(--text-muted)' }}>
                  ({(chances.get(bet.id) ?? 0).toFixed(1)}% {t.chance})
                </span>
                {me !== null && (bet.userId === me.userId || me.isAdmin) && (
                  <button
                    type="button"
                    className="btn-danger"
                    style={{ fontSize: 12, marginLeft: 6 }}
                    title={t.removeBet}
                    disabled={pending}
                    onClick={() => onWithdraw(bet.id)}
                  >
                    ✖
                  </button>
                )}
              </span>
            ))}
          </div>
        ) : (
          <div style={{ marginTop: 8, fontSize: 16 }}>
            <b style={{ color: item.status === 'DRAWN' ? 'var(--neon-green)' : 'var(--neon-red)' }}>
              {item.status === 'DRAWN' ? t.drawn : t.cancelledItem}
            </b>
            {item.winnerName && (
              <span style={{ marginLeft: 10 }}>
                {t.winner} <b style={{ color: 'var(--neon-orange)' }}>{item.winnerName}</b>
                {item.pointsPaid > 0 && ` (−${item.pointsPaid} ${t.pts})`}
              </span>
            )}
          </div>
        )}
      </div>

      {item.status === 'OPEN' && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {me !== null && accepting && !myBet && (
            <button type="button" className="btn btn-success btn-sm" onClick={onBet}>
              {t.bet}
            </button>
          )}
          {me?.isAdmin && item.bets.length > 0 && (
            <button type="button" className="btn btn-warning btn-sm" disabled={pending} onClick={onDraw}>
              {t.drawItem}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
