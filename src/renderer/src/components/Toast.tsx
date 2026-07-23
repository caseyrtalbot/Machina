import { useEffect, useState } from 'react'

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
    <div className="te-toast-host">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="te-toast"
          role="alert"
          title="Dismiss"
          onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}
