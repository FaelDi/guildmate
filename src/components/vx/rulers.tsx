'use client'

import { useState } from 'react'
import { updateThresholdsAction } from '@/app/actions/vortex'
import { useDictionary } from '@/components/locale-provider'
import { formatNumber } from './format'
import { useActionRunner } from './use-action'

/** The Mega and Titan combat-power rulers above every tab. */
export function Rulers({ mega, titan, isAdmin }: { mega: number; titan: number; isAdmin: boolean }) {
  const t = useDictionary().vx
  const { run, pending } = useActionRunner()
  const [megaValue, setMega] = useState(String(mega))
  const [titanValue, setTitan] = useState(String(titan))

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        gap: 30,
        marginBottom: 25,
        flexWrap: 'wrap',
        alignItems: 'center',
      }}
    >
      <div className="regua regua-mega">
        <span className="label">{t.megaRuler}</span>
        {isAdmin ? (
          <input
            className="input-edit"
            type="number"
            min={0}
            value={megaValue}
            onChange={(e) => setMega(e.target.value)}
            style={{ width: 150, fontSize: 22, color: '#fff' }}
          />
        ) : (
          <span className="value">{formatNumber(mega)}</span>
        )}
      </div>

      <div className="regua regua-tita">
        <span className="label">{t.titanRuler}</span>
        {isAdmin ? (
          <input
            className="input-edit"
            type="number"
            min={0}
            value={titanValue}
            onChange={(e) => setTitan(e.target.value)}
            style={{ width: 150, fontSize: 22, color: '#fff' }}
          />
        ) : (
          <span className="value">{formatNumber(titan)}</span>
        )}
      </div>

      {isAdmin && (
        <button
          type="button"
          className="btn btn-success"
          disabled={pending}
          onClick={() =>
            run(
              () =>
                updateThresholdsAction({
                  megaCpThreshold: Number(megaValue) || 0,
                  titanCpThreshold: Number(titanValue) || 0,
                }),
              t.rulersSaved,
            )
          }
        >
          {pending ? t.processing : t.saveRulers}
        </button>
      )}
    </div>
  )
}
