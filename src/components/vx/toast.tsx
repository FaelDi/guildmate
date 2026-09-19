'use client'

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

export type ToastKind = 'sucesso' | 'erro' | 'aviso' | 'info'

type Toast = { id: number; kind: ToastKind; message: string; shown: boolean }

const ICONS: Record<ToastKind, string> = { sucesso: '✓', erro: '✖', aviso: '⚠', info: 'ℹ' }
const DURATION_MS = 4500

const ToastContext = createContext<((message: string, kind?: ToastKind) => void) | null>(null)

let nextId = 1

/** The corner notifications every action reports through. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const show = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = nextId++
    setToasts((list) => [...list, { id, kind, message, shown: false }])
    // Two frames so the enter transition actually runs.
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        setToasts((list) => list.map((t) => (t.id === id ? { ...t, shown: true } : t))),
      ),
    )
    setTimeout(() => {
      setToasts((list) => list.map((t) => (t.id === id ? { ...t, shown: false } : t)))
      setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 400)
    }, DURATION_MS)
  }, [])

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-container" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.kind} ${toast.shown ? 'show' : ''}`}>
            <span className="toast-icon">{ICONS[toast.kind]}</span>
            <span className="toast-msg">{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): (message: string, kind?: ToastKind) => void {
  const show = useContext(ToastContext)
  if (!show) throw new Error('useToast must be used inside a ToastProvider')
  return show
}
