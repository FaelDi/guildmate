'use client'

import { useState } from 'react'
import { useDictionary } from '@/components/locale-provider'
import { fill } from './format'

/** Client-side paging over an already bounded list, like the original tables. */
export function usePage<T>(items: readonly T[], pageSize = 15) {
  const [page, setPage] = useState(1)
  const total = Math.max(1, Math.ceil(items.length / pageSize))
  const current = Math.min(page, total)
  return {
    slice: items.slice((current - 1) * pageSize, current * pageSize),
    page: current,
    total,
    setPage,
  }
}

export function Pagination({
  page,
  total,
  setPage,
}: {
  page: number
  total: number
  setPage: (page: number) => void
}) {
  const t = useDictionary().vx
  if (total <= 1) return null
  return (
    <div className="paginacao-controles">
      <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
        {t.prev}
      </button>
      <span className="pagina-atual">{fill(t.pageOf, { page, total })}</span>
      <button type="button" disabled={page >= total} onClick={() => setPage(page + 1)}>
        {t.next}
      </button>
    </div>
  )
}
