import { useEffect, useMemo, useRef, useState } from 'react'
import { useVaultStore } from '../../../store/vault-store'
import { colors, typography } from '../../../design/tokens'

interface LoadFailure {
  readonly code: number
  readonly description: string
  readonly url: string
}

export function TerminalDockAdapter({ sessionId }: { readonly sessionId: string }) {
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const preloadPath = useMemo(() => 'file://' + window.api.getTerminalPreloadPath(), [])
  // When sessionId is empty the webview's TerminalApp spawns a fresh PTY
  // rooted at the vault cwd; passing a sessionId reattaches to a survivor.
  const webviewSrc = useMemo(() => {
    const params = new URLSearchParams()
    if (sessionId) params.set('sessionId', sessionId)
    if (vaultPath) {
      params.set('vaultPath', vaultPath)
      if (!sessionId) params.set('cwd', vaultPath)
    }
    const base = import.meta.env.DEV
      ? new URL('/terminal-webview/index.html', window.location.origin).href
      : new URL('./terminal-webview/index.html', window.location.href).href
    const qs = params.toString()
    return qs ? `${base}?${qs}` : base
  }, [sessionId, vaultPath])

  const webviewRef = useRef<Electron.WebviewTag | null>(null)
  const [failure, setFailure] = useState<LoadFailure | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  // Reset stale failure during render when the webview navigates to a fresh
  // URL or the user clicks reload. React's recommended pattern for prop-derived
  // resets, avoiding the cascading-render warning of setState-in-effect.
  const [resetKey, setResetKey] = useState({ src: webviewSrc, reloadKey })
  if (resetKey.src !== webviewSrc || resetKey.reloadKey !== reloadKey) {
    setResetKey({ src: webviewSrc, reloadKey })
    setFailure(null)
  }

  useEffect(() => {
    const el = webviewRef.current
    if (!el) return
    // Electron emits did-fail-load on navigation errors. -3 (ABORTED) fires for
    // benign in-flight navigation cancellations and is not a real failure.
    type FailEvent = { errorCode: number; errorDescription: string; validatedURL: string }
    const onFail = (e: Event) => {
      const detail = e as unknown as FailEvent
      if (detail.errorCode === -3) return
      setFailure({
        code: detail.errorCode,
        description: detail.errorDescription,
        url: detail.validatedURL
      })
    }
    const onLoad = () => setFailure(null)
    el.addEventListener('did-fail-load', onFail as EventListener)
    el.addEventListener('did-finish-load', onLoad)
    return () => {
      el.removeEventListener('did-fail-load', onFail as EventListener)
      el.removeEventListener('did-finish-load', onLoad)
    }
  }, [webviewSrc, reloadKey])

  /* eslint-disable react/no-unknown-property */
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <webview
        key={reloadKey}
        ref={webviewRef as unknown as React.RefObject<HTMLElement>}
        src={webviewSrc}
        preload={preloadPath}
        style={{
          width: '100%',
          height: '100%',
          visibility: failure ? 'hidden' : 'visible'
        }}
        webpreferences="contextIsolation=yes, sandbox=yes"
      />
      {failure && (
        <div
          role="alert"
          data-testid="terminal-webview-error"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            justifyContent: 'center',
            padding: 24,
            gap: 8,
            background: colors.bg.surface,
            color: colors.text.primary,
            fontFamily: typography.fontFamily.mono,
            fontSize: 12,
            lineHeight: 1.6
          }}
        >
          <div
            style={{
              color: colors.claude.error,
              fontSize: typography.metadata.size,
              letterSpacing: typography.metadata.letterSpacing,
              textTransform: typography.metadata.textTransform
            }}
          >
            terminal webview failed to load
          </div>
          <div style={{ color: colors.text.secondary }}>
            {failure.description} (code {failure.code})
          </div>
          <div style={{ color: colors.text.muted, wordBreak: 'break-all' }}>{failure.url}</div>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            style={{
              marginTop: 8,
              padding: '6px 12px',
              background: 'transparent',
              border: `0.5px solid ${colors.border.default}`,
              color: colors.text.primary,
              fontFamily: typography.fontFamily.mono,
              fontSize: typography.metadata.size,
              letterSpacing: typography.metadata.letterSpacing,
              textTransform: typography.metadata.textTransform,
              cursor: 'pointer'
            }}
          >
            retry
          </button>
        </div>
      )}
    </div>
  )
  /* eslint-enable react/no-unknown-property */
}
