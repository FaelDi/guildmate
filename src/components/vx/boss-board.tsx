'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  deleteBossAction,
  deleteBossGroupAction,
  saveBossAction,
  saveBossGroupAction,
  setRotationAction,
} from '@/app/actions/vortex'
import { useDictionary } from '@/components/locale-provider'
import { brtDay, nextSpawn, type BossSchedule } from '@/lib/rules'
import { fill, pad2, splitDuration } from './format'
import { Modal } from './modal'
import { useActionRunner } from './use-action'

export type ScheduleView = {
  respawnKind: 'INTERVAL' | 'DAILY' | 'WEEKLY'
  intervalHours: number | null
  anchorAtMs: number | null
  dailyTimes: string | null
  weekdays: string | null
}

export type BossRow = {
  id: string
  name: string
  location: string
  groupId: string | null
  groupName: string | null
  inRotation: boolean
  schedule: ScheduleView | null
  /** The boss's own schedule (null when it follows a group). */
  ownSchedule: ScheduleView | null
}

export type GroupRow = { id: string; name: string; schedule: ScheduleView }

function toSchedule(view: ScheduleView): BossSchedule {
  return {
    respawnKind: view.respawnKind,
    intervalHours: view.intervalHours,
    anchorAt: view.anchorAtMs === null ? null : new Date(view.anchorAtMs),
    dailyTimes: view.dailyTimes,
    weekdays: view.weekdays,
  }
}

function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

/** "Escala de Bosses": this week's rotation, grouped by BRT day, counting down. */
export function BossBoard({
  guildName,
  bosses,
  groups,
  isAdmin,
}: {
  guildName: string
  bosses: BossRow[]
  groups: GroupRow[]
  isAdmin: boolean
}) {
  const t = useDictionary().vx
  const now = useNow()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const [panel, setPanel] = useState<'rotation' | 'bosses' | 'groups' | null>(null)

  const days = useMemo(() => {
    const at = new Date(now)
    const todayKey = brtDay(at).key
    const tomorrowKey = brtDay(new Date(now + 86_400_000)).key

    const entries = bosses
      .filter((b) => b.inRotation && b.schedule)
      .map((b) => ({ boss: b, next: nextSpawn(toSchedule(b.schedule as ScheduleView), at) }))
      .filter((e): e is { boss: BossRow; next: Date } => e.next !== null)
      .sort((a, b) => a.next.getTime() - b.next.getTime())

    const groupsByDay = new Map<string, { label: string; items: typeof entries }>()
    for (const entry of entries) {
      const day = brtDay(entry.next)
      let group = groupsByDay.get(day.key)
      if (!group) {
        let label = `${t.weekdays[day.weekday] ?? ''} (${pad2(day.day)}/${pad2(day.month)})`
        if (day.key === todayKey) label = `${t.today} - ${label}`
        else if (day.key === tomorrowKey) label = `${t.tomorrow} - ${label}`
        group = { label, items: [] }
        groupsByDay.set(day.key, group)
      }
      group.items.push(entry)
    }
    return [...groupsByDay.values()]
    // Re-bucket once a minute, not every second: the countdowns tick on their own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bosses, Math.floor(now / 60_000), t])

  function when(next: Date): string {
    const day = brtDay(next)
    const brt = new Date(next.getTime() - 3 * 3_600_000)
    const time = `${pad2(brt.getUTCHours())}:${pad2(brt.getUTCMinutes())}`
    if (day.key === brtDay(new Date(now)).key) return fill(t.todayAt, { time })
    if (day.key === brtDay(new Date(now + 86_400_000)).key) return fill(t.tomorrowAt, { time })
    return fill(t.dateAt, { date: `${pad2(day.day)}/${pad2(day.month)}`, time })
  }

  function remaining(next: Date): string {
    const d = splitDuration(next.getTime() - now)
    if (d.days > 0) return fill(t.remainingDays, { d: d.days, h: pad2(d.hours), m: pad2(d.minutes) })
    if (d.hours > 0) return fill(t.remainingHours, { h: pad2(d.hours), m: pad2(d.minutes) })
    return fill(t.remainingMinutes, { m: pad2(d.minutes), s: pad2(d.seconds) })
  }

  return (
    <div className="table-container" style={{ borderLeftColor: 'var(--neon-cyan)' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <h2 style={{ color: 'var(--neon-cyan)', textShadow: '0 0 12px rgba(0, 243, 255, 0.4)', margin: 0 }}>
          {t.bossesTitle}
        </h2>
        {isAdmin && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-warning btn-sm" onClick={() => setPanel('rotation')}>
              {t.manageRotation}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setPanel('bosses')}>
              {t.manageBosses}
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setPanel('groups')}>
              {t.manageGroups}
            </button>
          </div>
        )}
      </div>

      <div
        style={{
          background: 'rgba(10, 10, 15, 0.95)',
          padding: 25,
          borderRadius: 8,
          border: '1px solid var(--glass-border)',
        }}
      >
        <div
          style={{
            textAlign: 'center',
            marginBottom: 30,
            borderBottom: '1px dashed rgba(255,255,255,0.1)',
            paddingBottom: 15,
          }}
        >
          <h2 style={{ color: '#fff', margin: 0, fontSize: 28, justifyContent: 'center', textShadow: 'none' }}>
            {fill(t.bossesExportTitle, { guild: guildName })}
          </h2>
        </div>

        {!mounted ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40, fontSize: 18 }}>
            {t.bossesLoading}
          </div>
        ) : days.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40, fontSize: 18 }}>
            {t.bossesEmpty}
          </div>
        ) : (
          days.map((day) => (
            <div key={day.label} style={{ marginBottom: 25 }}>
              <h3 className="boss-day-title">{day.label}</h3>
              <div className="boss-grid">
                {day.items.map(({ boss, next }) => (
                  <div key={boss.id} className="boss-card">
                    <div style={{ fontSize: 35, textShadow: '0 0 10px var(--neon-cyan)' }}>😈</div>
                    <div style={{ flex: 1 }}>
                      <div className="boss-group-chip">🛡️ {boss.groupName ?? t.noGroup}</div>
                      <div style={{ color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 4 }}>{boss.name}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 12 }}>📍 {boss.location}</div>
                      <div className="boss-when">
                        <div style={{ color: '#fff', fontSize: 16, fontWeight: 'bold', marginBottom: 4, letterSpacing: 1 }}>
                          📅 {when(next)}
                        </div>
                        <div style={{ color: 'var(--neon-cyan)', fontSize: 15, fontWeight: 'bold' }}>⏳ {remaining(next)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {isAdmin && panel === 'rotation' && <RotationModal bosses={bosses} onClose={() => setPanel(null)} />}
      {isAdmin && panel === 'bosses' && <BossesModal bosses={bosses} groups={groups} onClose={() => setPanel(null)} />}
      {isAdmin && panel === 'groups' && <GroupsModal groups={groups} onClose={() => setPanel(null)} />}
    </div>
  )
}

function RotationModal({ bosses, onClose }: { bosses: BossRow[]; onClose: () => void }) {
  const t = useDictionary().vx
  const { run, pending } = useActionRunner()
  const [picked, setPicked] = useState(() => new Set(bosses.filter((b) => b.inRotation).map((b) => b.id)))

  const byGroup = new Map<string, BossRow[]>()
  for (const boss of bosses) {
    const key = boss.groupName ?? t.otherBosses
    byGroup.set(key, [...(byGroup.get(key) ?? []), boss])
  }

  return (
    <Modal open onClose={onClose}>
      <h2>{t.rotationTitle}</h2>
      {[...byGroup.entries()].map(([group, list]) => (
        <div key={group}>
          <div
            style={{
              color: 'var(--neon-orange)',
              fontWeight: 'bold',
              marginTop: 15,
              borderBottom: '1px dashed var(--glass-border)',
              paddingBottom: 5,
            }}
          >
            {group}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10, marginTop: 10 }}>
            {list.map((boss) => (
              <label
                key={boss.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: 'rgba(0,0,0,0.3)',
                  padding: 8,
                  borderRadius: 4,
                  border: `1px solid ${picked.has(boss.id) ? 'var(--neon-orange)' : 'rgba(255,255,255,0.1)'}`,
                }}
              >
                <input
                  type="checkbox"
                  checked={picked.has(boss.id)}
                  onChange={(e) =>
                    setPicked((current) => {
                      const next = new Set(current)
                      if (e.target.checked) next.add(boss.id)
                      else next.delete(boss.id)
                      return next
                    })
                  }
                  style={{ accentColor: 'var(--neon-orange)' }}
                />
                <span style={{ color: '#fff', fontSize: 14 }}>{boss.name}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
      <div className="modal-actions">
        <button type="button" className="btn btn-muted" onClick={onClose}>
          {t.cancel}
        </button>
        <button
          type="button"
          className="btn btn-success"
          disabled={pending}
          onClick={async () => {
            const result = await run(() => setRotationAction({ bossIds: [...picked] }), t.rotationSaved)
            if (result.ok) onClose()
          }}
        >
          {t.confirm}
        </button>
      </div>
    </Modal>
  )
}

const EMPTY_SCHEDULE: ScheduleView = {
  respawnKind: 'DAILY',
  intervalHours: 24,
  anchorAtMs: null,
  dailyTimes: '20:00',
  weekdays: null,
}

/** "2026-09-19T18:30" in BRT for a datetime-local input, and back. */
function msToBrtInput(ms: number | null): string {
  if (ms === null) return ''
  const brt = new Date(ms - 3 * 3_600_000)
  return `${brt.getUTCFullYear()}-${pad2(brt.getUTCMonth() + 1)}-${pad2(brt.getUTCDate())}T${pad2(brt.getUTCHours())}:${pad2(brt.getUTCMinutes())}`
}

function brtInputToMs(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number]
  return Date.UTC(y, mo - 1, d, h, mi) + 3 * 3_600_000
}

function ScheduleFields({ value, onChange }: { value: ScheduleView; onChange: (next: ScheduleView) => void }) {
  const t = useDictionary().vx
  const days = new Set((value.weekdays ?? '').split(',').filter(Boolean))

  return (
    <>
      <label className="field-label">{t.respawnKind}</label>
      <select
        className="input-edit"
        value={value.respawnKind}
        onChange={(e) => onChange({ ...value, respawnKind: e.target.value as ScheduleView['respawnKind'] })}
        style={{ width: '100%' }}
      >
        <option value="INTERVAL">{t.respawn.INTERVAL}</option>
        <option value="DAILY">{t.respawn.DAILY}</option>
        <option value="WEEKLY">{t.respawn.WEEKLY}</option>
      </select>

      {value.respawnKind === 'INTERVAL' ? (
        <>
          <label className="field-label">{t.intervalHours}</label>
          <input
            className="input-edit"
            type="number"
            min={1}
            value={value.intervalHours ?? ''}
            onChange={(e) => onChange({ ...value, intervalHours: Number(e.target.value) || null })}
            style={{ width: '100%' }}
          />
          <label className="field-label">{t.anchorAt}</label>
          <input
            className="input-edit"
            type="datetime-local"
            value={msToBrtInput(value.anchorAtMs)}
            onChange={(e) => onChange({ ...value, anchorAtMs: brtInputToMs(e.target.value) })}
            style={{ width: '100%' }}
          />
        </>
      ) : (
        <>
          <label className="field-label">{t.dailyTimes}</label>
          <input
            className="input-edit"
            value={value.dailyTimes ?? ''}
            placeholder="16:00, 22:30"
            onChange={(e) => onChange({ ...value, dailyTimes: e.target.value })}
            style={{ width: '100%' }}
          />
          {value.respawnKind === 'WEEKLY' && (
            <>
              <label className="field-label">{t.weekdaysLabel}</label>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {t.weekdaysShort.map((label, index) => (
                  <label key={label} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={days.has(String(index))}
                      onChange={(e) => {
                        const next = new Set(days)
                        if (e.target.checked) next.add(String(index))
                        else next.delete(String(index))
                        onChange({ ...value, weekdays: [...next].sort().join(',') || null })
                      }}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  )
}

function GroupsModal({ groups, onClose }: { groups: GroupRow[]; onClose: () => void }) {
  const t = useDictionary().vx
  const { run, pending } = useActionRunner()
  const [editing, setEditing] = useState<{ id: string | null; name: string; schedule: ScheduleView } | null>(null)

  return (
    <Modal open onClose={onClose}>
      <h2>{t.groupsTitle}</h2>
      {editing ? (
        <>
          <label className="field-label">{t.groupName}</label>
          <input
            className="input-edit"
            value={editing.name}
            maxLength={120}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            style={{ width: '100%', textAlign: 'left' }}
          />
          <ScheduleFields value={editing.schedule} onChange={(schedule) => setEditing({ ...editing, schedule })} />
          <div className="modal-actions">
            <button type="button" className="btn btn-muted" onClick={() => setEditing(null)}>
              {t.cancel}
            </button>
            <button
              type="button"
              className="btn btn-success"
              disabled={pending}
              onClick={async () => {
                const result = await run(() => saveBossGroupAction(editing), t.saved)
                if (result.ok) setEditing(null)
              }}
            >
              {t.save}
            </button>
          </div>
        </>
      ) : (
        <>
          <table>
            <tbody>
              {groups.map((group) => (
                <tr key={group.id}>
                  <td className="left">
                    <b>{group.name}</b>
                    <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>
                      {t.respawn[group.schedule.respawnKind]}{' '}
                      {group.schedule.respawnKind === 'INTERVAL'
                        ? `${group.schedule.intervalHours}h`
                        : group.schedule.dailyTimes}
                    </div>
                  </td>
                  <td style={{ width: 130 }}>
                    <button type="button" className="btn btn-sm" onClick={() => setEditing({ ...group })}>
                      {t.edit}
                    </button>{' '}
                    <button
                      type="button"
                      className="btn-danger"
                      disabled={pending}
                      onClick={() => {
                        if (window.confirm(t.deleteConfirm)) run(() => deleteBossGroupAction({ id: group.id }), t.deleted)
                      }}
                    >
                      ✖
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="modal-actions">
            <button type="button" className="btn btn-muted" onClick={onClose}>
              {t.close}
            </button>
            <button
              type="button"
              className="btn btn-success"
              onClick={() => setEditing({ id: null, name: '', schedule: { ...EMPTY_SCHEDULE } })}
            >
              {t.newGroup}
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}

type BossDraft = {
  id: string | null
  name: string
  location: string
  groupId: string | null
  schedule: ScheduleView
}

function BossesModal({ bosses, groups, onClose }: { bosses: BossRow[]; groups: GroupRow[]; onClose: () => void }) {
  const t = useDictionary().vx
  const { run, pending } = useActionRunner()
  const [editing, setEditing] = useState<BossDraft | null>(null)

  return (
    <Modal open onClose={onClose} width={700}>
      <h2>{t.bossesListTitle}</h2>
      {editing ? (
        <>
          <label className="field-label">{t.bossName}</label>
          <input
            className="input-edit"
            value={editing.name}
            maxLength={120}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            style={{ width: '100%', textAlign: 'left' }}
          />
          <label className="field-label">{t.bossLocation}</label>
          <input
            className="input-edit"
            value={editing.location}
            maxLength={120}
            onChange={(e) => setEditing({ ...editing, location: e.target.value })}
            style={{ width: '100%', textAlign: 'left' }}
          />
          <label className="field-label">{t.bossGroup}</label>
          <select
            className="input-edit"
            value={editing.groupId ?? ''}
            onChange={(e) => setEditing({ ...editing, groupId: e.target.value || null })}
            style={{ width: '100%' }}
          >
            <option value="">{t.ownSchedule}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          {editing.groupId === null && (
            <ScheduleFields value={editing.schedule} onChange={(schedule) => setEditing({ ...editing, schedule })} />
          )}
          <div className="modal-actions">
            <button type="button" className="btn btn-muted" onClick={() => setEditing(null)}>
              {t.cancel}
            </button>
            <button
              type="button"
              className="btn btn-success"
              disabled={pending}
              onClick={async () => {
                const result = await run(
                  () =>
                    saveBossAction({
                      id: editing.id,
                      name: editing.name,
                      location: editing.location,
                      groupId: editing.groupId,
                      schedule: editing.groupId === null ? editing.schedule : null,
                    }),
                  t.saved,
                )
                if (result.ok) setEditing(null)
              }}
            >
              {t.save}
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{ maxHeight: '55vh', overflowY: 'auto' }}>
            <table>
              <tbody>
                {bosses.map((boss) => (
                  <tr key={boss.id}>
                    <td className="left">
                      <b>{boss.name}</b>
                      <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>
                        📍 {boss.location} · 🛡️ {boss.groupName ?? t.noGroup}
                      </div>
                    </td>
                    <td style={{ width: 130 }}>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() =>
                          setEditing({
                            id: boss.id,
                            name: boss.name,
                            location: boss.location,
                            groupId: boss.groupId,
                            schedule: boss.ownSchedule ?? { ...EMPTY_SCHEDULE },
                          })
                        }
                      >
                        {t.edit}
                      </button>{' '}
                      <button
                        type="button"
                        className="btn-danger"
                        disabled={pending}
                        onClick={() => {
                          if (window.confirm(t.deleteConfirm)) run(() => deleteBossAction({ id: boss.id }), t.deleted)
                        }}
                      >
                        ✖
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-muted" onClick={onClose}>
              {t.close}
            </button>
            <button
              type="button"
              className="btn btn-success"
              onClick={() =>
                setEditing({
                  id: null,
                  name: '',
                  location: '',
                  groupId: groups[0]?.id ?? null,
                  schedule: { ...EMPTY_SCHEDULE },
                })
              }
            >
              {t.newBoss}
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
