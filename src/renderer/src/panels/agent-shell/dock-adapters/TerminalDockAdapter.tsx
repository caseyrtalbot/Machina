import { useEffect, useMemo, useRef, useState } from 'react'
import { useVaultStore } from '../../../store/vault-store'
import { colors, typography } from '../../../design/tokens'
import { buildTerminalWebviewSrc, resolveTerminalWebviewBase } from '../terminal-webview-src'

interface LoadFailure {
  readonly code: number
  readonly description: string
  readonly url: string
}

interface TerminalDockAdapterProps {
  readonly sessionId: string
  /** Spawn/respawn directory. Defaults to the vault root. */
  readonly cwd?: string
  /** Fires when the webview spawns a fresh PTY (fresh launch or stale-session respawn). */
  readonly onSessionCreated?: (sessionId: string) => void
  /** Fires when the PTY exits (user typed `exit`, process ended). */
  readonly onSessionExited?: () => void
}

export function TerminalDockAdapter({
  sessionId,
  cwd,
  onSessionCreated,
  onSessionExited
}: TerminalDockAdapterProps) {
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const preloadPath = useMemo(() => 'file://' + window.api.getTerminalPreloadPath(), [])
  // When sessionId is empty the webview's TerminalApp spawns a fresh PTY at
  // cwd; passing a sessionId reattaches to a survivor, and cwd doubles as the
  // respawn target when that sessionId turns out to be stale.
  const webviewSrc = useMemo(() => {
    const base = resolveTerminalWebviewBase(
      import.meta.env.DEV,
      window.location.origin,
      window.location.href
    )
    return buildTerminalWebviewSrc(base, {
      sessionId: sessionId || undefined,
      cwd: cwd ?? vaultPath ?? undefined,
      vaultPath: vaultPath ?? undefined
    })
  }, [sessionId, cwd, vaultPath])

  // Session lifecycle callbacks live in refs so a new callback identity does
  // not tear down and re-register the webview listeners mid-session.
  const onSessionCreatedRef = useRef(onSessionCreated)
  const onSessionExitedRef = useRef(onSessionExited)
  useEffect(() => {
    onSessionCreatedRef.current = onSessionCreated
    onSessionExitedRef.current = onSessionExited
  }, [onSessionCreated, onSessionExited])

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
    // Guest lifecycle messages (same protocol as TerminalCard): the webview
    // reports the sessionId it actually runs, which is how a dock terminal
    // learns its identity after a fresh spawn or a stale-session respawn.
    const onIpcMessage = (event: Event): void => {
      const ipcEvent = event as Event & {
        readonly channel: string
        readonly args: readonly unknown[]
      }
      if (ipcEvent.channel === 'session-created') {
        onSessionCreatedRef.current?.(String(ipcEvent.args[0]))
      } else if (ipcEvent.channel === 'session-exited') {
        onSessionExitedRef.current?.()
      }
    }
    el.addEventListener('did-fail-load', onFail as EventListener)
    el.addEventListener('did-finish-load', onLoad)
    el.addEventListener('ipc-message', onIpcMessage)
    return () => {
      el.removeEventListener('did-fail-load', onFail as EventListener)
      el.removeEventListener('did-finish-load', onLoad)
      el.removeEventListener('ipc-message', onIpcMessage)
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
              border: `1px solid ${colors.border.default}`,
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
