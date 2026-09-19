'use client'

import { useState } from 'react'
import { advanceWeekAction, createBannerAction } from '@/app/actions/vortex'
import { useDictionary } from '@/components/locale-provider'
import { fill } from './format'
import { Modal } from './modal'
import { useToast } from './toast'
import { useActionRunner } from './use-action'

type DraftItem = { name: string; maxPoints: string; restriction: 'ALL' | 'TITAN' | 'MEGA' }

const EMPTY_ITEM: DraftItem = { name: '', maxPoints: '100', restriction: 'ALL' }

/** The admin-only controls in the header: next week and a new loot banner. */
export function AdminToolbar({ hasOpenBanner }: { hasOpenBanner: boolean }) {
  const t = useDictionary().vx
  const toast = useToast()
  const { run, pending } = useActionRunner()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [deadline, setDeadline] = useState('24')
  const [items, setItems] = useState<DraftItem[]>([{ ...EMPTY_ITEM }])

  function patchItem(index: number, patch: Partial<DraftItem>) {
    setItems((list) => list.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  async function publish() {
    const filled = items.filter((item) => item.name.trim().length > 0)
    if (filled.length === 0) {
      toast(t.needItem, 'aviso')
      return
    }
    const result = await run(
      () =>
        createBannerAction({
          title,
          durationHours: deadline === 'none' ? null : Number(deadline),
          items: filled.map((item) => ({
            name: item.name,
            maxPoints: Number(item.maxPoints) || 0,
            restriction: item.restriction,
          })),
        }),
      t.published,
    )
    if (result.ok) {
      setOpen(false)
      setTitle('')
      setItems([{ ...EMPTY_ITEM }])
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-outline"
        disabled={pending}
        onClick={() => {
          if (window.confirm(t.newWeekConfirm)) {
            run(() => advanceWeekAction(), (data) => fill(t.newWeekDone, { number: data.number }))
          }
        }}
      >
        {t.newWeek}
      </button>
      {!hasOpenBanner && (
        <button type="button" className="btn btn-warning" onClick={() => setOpen(true)}>
          {t.publishBanner}
        </button>
      )}

      <Modal open={open} onClose={() => setOpen(false)} borderColor="var(--neon-orange)">
        <h2 style={{ color: 'var(--neon-orange)' }}>{t.publishTitle}</h2>

        <label className="field-label">{t.bannerTitle}</label>
        <input
          className="input-edit"
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          style={{ width: '100%', textAlign: 'left' }}
        />

        <label className="field-label">{t.bannerDeadline}</label>
        <select
          className="input-edit"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          style={{ width: '100%' }}
        >
          {[1, 2, 6, 12, 24, 48, 72, 168].map((h) => (
            <option key={h} value={h}>
              {fill(t.hours, { n: h })}
            </option>
          ))}
          <option value="none">{t.noLimit}</option>
        </select>

        <label className="field-label">{t.items}</label>
        {items.map((item, index) => (
          <div key={index} style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <input
              className="input-edit"
              placeholder={fill(t.itemName, { n: index + 1 })}
              value={item.name}
              maxLength={120}
              onChange={(e) => patchItem(index, { name: e.target.value })}
              style={{ flex: '2 1 180px', textAlign: 'left' }}
            />
            <select
              className="input-edit"
              value={item.restriction}
              onChange={(e) => patchItem(index, { restriction: e.target.value as DraftItem['restriction'] })}
              style={{ flex: '1 1 120px' }}
            >
              <option value="ALL">{t.restriction.ALL}</option>
              <option value="TITAN">{t.restriction.TITAN}</option>
              <option value="MEGA">{t.restriction.MEGA}</option>
            </select>
            <input
              className="input-edit"
              type="number"
              min={1}
              placeholder={t.itemPoints}
              value={item.maxPoints}
              onChange={(e) => patchItem(index, { maxPoints: e.target.value })}
              style={{ flex: '1 1 100px' }}
            />
          </div>
        ))}
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setItems((list) => (list.length >= 20 ? list : [...list, { ...EMPTY_ITEM }]))}
        >
          {t.addItem}
        </button>

        <div className="modal-actions">
          <button type="button" className="btn btn-muted" onClick={() => setOpen(false)}>
            {t.cancel}
          </button>
          <button type="button" className="btn btn-warning" disabled={pending} onClick={publish}>
            {pending ? t.processing : t.publish}
          </button>
        </div>
      </Modal>
    </>
  )
}
