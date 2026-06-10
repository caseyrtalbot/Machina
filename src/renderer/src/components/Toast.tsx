import { useEffect, useState } from 'react'
import { colors, floatingPanel, zIndex } from '../design/tokens'

interface ToastItem {
  readonly id: number
  readonly message: string
}

type ToastListener = (message: string) => void

let _listener: ToastListener | null = null
let _pending: readonly string[] = []

/**
 * Show a user-facing toast. Safe to call before ToastHost mounts —
 * messages queue and flush on mount. App init wires this into
 * `setErrorNotifier` so `notifyError` calls reach the user.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function showToast(message: string): void {
  if (_listener) {
    _listener(message)
  } else {
    _pending = [..._pending, message]
  }
}

const AUTO_DISMISS_MS = 6000

let _nextId = 0

/** Bottom-right toast stack. Mount once at the app root. */
export function ToastHost() {
  const [toasts, setToasts] = useState<readonly ToastItem[]>([])

  useEffect(() => {
    const add = (message: string): void => {
      const id = _nextId++
      setToasts((prev) => [...prev, { id, message }])
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, AUTO_DISMISS_MS)
    }
    _listener = add
    const queued = _pending
    _pending = []
    for (const message of queued) add(message)
    return () => {
      if (_listener === add) _listener = null
    }
  }, [])

  if (toasts.length === 0) return null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: zIndex.tooltip,
        maxWidth: 380
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="alert"
          title="Dismiss"
          onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
          style={{
            background: floatingPanel.glass.bg,
            backdropFilter: floatingPanel.glass.blur,
            border: `1px solid ${colors.border.subtle}`,
            borderLeft: '2px solid var(--color-accent-default)',
            boxShadow: floatingPanel.shadowCompact,
            color: colors.text.primary,
            fontSize: 12.5,
            lineHeight: 1.45,
            padding: '10px 14px',
            cursor: 'pointer',
            wordBreak: 'break-word'
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}
