import { createContext, useContext, useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const ToastContext = createContext(null)

/**
 * useToast() -> { show, update, dismiss }
 *   show({ message, type, duration, link, linkLabel, actionLabel, onAction }) -> id
 *   update(id, patch)  — used for progress toasts ("3 of 7 added...")
 *   dismiss(id)
 */
export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}

const ACCENT = {
  success: '#16a34a',
  error: '#dc2626',
  info: '#991b1b',
  progress: '#dc2626'
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const idRef = useRef(0)
  const timersRef = useRef({})

  const dismiss = useCallback((id) => {
    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id])
      delete timersRef.current[id]
    }
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const scheduleDismiss = useCallback((id, duration) => {
    if (timersRef.current[id]) clearTimeout(timersRef.current[id])
    if (duration > 0) {
      timersRef.current[id] = setTimeout(() => dismiss(id), duration)
    }
  }, [dismiss])

  const show = useCallback((options) => {
    const opts = typeof options === 'string' ? { message: options } : (options || {})
    const id = ++idRef.current
    const toast = {
      id,
      message: opts.message || '',
      type: opts.type || 'info',
      link: opts.link || null,
      linkLabel: opts.linkLabel || 'Open',
      actionLabel: opts.actionLabel || null,
      onAction: opts.onAction || null
    }
    setToasts(prev => [...prev, toast])
    const duration = opts.duration === undefined ? 5000 : opts.duration
    scheduleDismiss(id, duration)
    return id
  }, [scheduleDismiss])

  const update = useCallback((id, patch) => {
    setToasts(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)))
    if (patch && patch.duration !== undefined) scheduleDismiss(id, patch.duration)
  }, [scheduleDismiss])

  return (
    <ToastContext.Provider value={{ show, update, dismiss }}>
      {children}
      <div className="fixed left-0 right-0 z-[60] flex flex-col items-center gap-2 px-4 pointer-events-none"
        style={{ bottom: 'calc(84px + env(safe-area-inset-bottom))' }}>
        <AnimatePresence>
          {toasts.map(toast => (
            <motion.div
              key={toast.id}
              className="glass px-4 py-3 w-full max-w-md pointer-events-auto flex items-start gap-3"
              style={{ borderColor: `${ACCENT[toast.type] || ACCENT.info}55` }}
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ duration: 0.18 }}
            >
              <span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
                style={{ background: ACCENT[toast.type] || ACCENT.info }} />
              <div className="flex-1 min-w-0">
                <p className="text-sm leading-snug">{toast.message}</p>
                <div className="flex gap-3 mt-1">
                  {toast.link && (
                    <a
                      href={toast.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono uppercase text-[10px] tracking-wider text-red hover:underline"
                    >
                      {toast.linkLabel} ↗
                    </a>
                  )}
                  {toast.actionLabel && toast.onAction && (
                    <button
                      onClick={() => { toast.onAction(); dismiss(toast.id) }}
                      className="font-mono uppercase text-[10px] tracking-wider text-red hover:underline"
                    >
                      {toast.actionLabel}
                    </button>
                  )}
                </div>
              </div>
              <button
                onClick={() => dismiss(toast.id)}
                className="text-muted hover:text-ink text-sm leading-none mt-0.5"
                aria-label="Dismiss"
              >
                ×
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}
