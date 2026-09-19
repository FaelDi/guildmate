'use client'

import { useEffect, type CSSProperties, type ReactNode } from 'react'

/**
 * The command-center modal: a blurred overlay with a notched panel. Escape and
 * a click on the backdrop close it unless `locked` (a spinning wheel must not
 * be dismissed mid-draw).
 */
export function Modal({
  open,
  onClose,
  children,
  width,
  borderColor,
  locked = false,
  zIndex,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  width?: number
  borderColor?: string
  locked?: boolean
  zIndex?: number
}) {
  useEffect(() => {
    if (!open || locked) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, locked, onClose])

  if (!open) return null

  const style: CSSProperties = {}
  if (width) style.width = width
  if (borderColor) style.borderColor = borderColor

  return (
    <div
      className="modal-overlay"
      style={zIndex ? { zIndex } : undefined}
      onMouseDown={(event) => {
        if (!locked && event.target === event.currentTarget) onClose()
      }}
    >
      <div className="modal-content" role="dialog" aria-modal="true" style={style}>
        {children}
      </div>
    </div>
  )
}
