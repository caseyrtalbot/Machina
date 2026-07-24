import { useEffect, useMemo, useRef, useState } from 'react'
import { useVaultStore } from '../../../store/vault-store'
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
  /**
   * Agent-projection mode (workstation Phase 2 step 4, contracts §4):
   * reattach-only. A stale/dead/absent session renders a read-only dead
   * state — the adapter never mounts a webview that could terminal:create,
   * and the mounted webview URL carries `reattachOnly` so the guest's own
   * create fallback is disabled too (both layers enforce the no-respawn
   * rule). The stale-session respawn stays correct for plain terminals.
   */
  readonly projection?: 'agent'
}

export function TerminalDockAdapter({
  sessionId,
  cwd,
  onSessionCreated,
  onSessionExited,
  projection
}: TerminalDockAdapterProps) {
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const preloadPath = useMemo(() => 'file://' + window.api.getTerminalPreloadPath(), [])
  const reattachOnly = projection === 'agent'
  // When sessionId is empty the webview's TerminalApp spawns a fresh PTY at
  // cwd; passing a sessionId reattaches to a survivor, and cwd doubles as the
  // respawn target when that sessionId turns out to be stale. Agent
  // projections instead set reattachOnly and omit cwd entirely: nothing in
  // the guest may create, and nothing in the URL says where to.
  const webviewSrc = useMemo(() => {
    const base = resolveTerminalWebviewBase(
      import.meta.env.DEV,
      window.location.origin,
      window.location.href
    )
    return buildTerminalWebviewSrc(base, {
      sessionId: sessionId || undefined,
      cwd: reattachOnly ? undefined : (cwd ?? vaultPath ?? undefined),
      vaultPath: reattachOnly ? undefined : (vaultPath ?? undefined),
      reattachOnly: reattachOnly || undefined
    })
  }, [sessionId, cwd, vaultPath, reattachOnly])

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
  const [dead, setDead] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  // Reset stale failure/dead state during render when the webview navigates
  // to a fresh URL or the user clicks reload. React's recommended pattern for
  // prop-derived resets, avoiding the cascading-render warning of
  // setState-in-effect.
  const [resetKey, setResetKey] = useState({ src: webviewSrc, reloadKey })
  if (resetKey.src !== webviewSrc || resetKey.reloadKey !== reloadKey) {
    setResetKey({ src: webviewSrc, reloadKey })
    setFailure(null)
    setDead(false)
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
        // Agent projection: a PTY that exits under the raw view flips to the
        // read-only dead state (scrollback stays visible; nothing respawns).
        if (reattachOnly) setDead(true)
        onSessionExitedRef.current?.()
      } else if (ipcEvent.channel === 'session-dead') {
        // Reattach-only guest found no surviving PTY and (by contract) did
        // not create one — render the dead state.
        setDead(true)
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
  }, [webviewSrc, reloadKey, reattachOnly])

  // Adapter-layer no-respawn enforcement (contracts §4): with no session to
  // reattach to, an agent projection never mounts a webview at all — a
  // mounted guest with an empty sessionId would terminal:create.
  if (reattachOnly && !sessionId) {
    return <DeadSessionState />
  }

  /* eslint-disable react/no-unknown-property */
  return (
    <div className="te-term-adapter">
      <webview
        key={reloadKey}
        ref={webviewRef as unknown as React.RefObject<HTMLElement>}
        src={webviewSrc}
        preload={preloadPath}
        className="te-term-adapter-webview"
        style={{ visibility: failure ? 'hidden' : 'visible' }}
        webpreferences="contextIsolation=yes, sandbox=yes"
      />
      {dead && <DeadSessionState overlay />}
      {failure && (
        <div role="alert" data-testid="terminal-webview-error" className="te-term-adapter-error">
          <div className="te-term-adapter-error-eyebrow">terminal webview failed to load</div>
          <div className="te-term-adapter-error-desc">
            {failure.description} (code {failure.code})
          </div>
          <div className="te-term-adapter-error-url">{failure.url}</div>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="te-term-adapter-retry"
          >
            retry
          </button>
        </div>
      )}
    </div>
  )
  /* eslint-enable react/no-unknown-property */
}

/**
 * Read-only dead state for agent projections (workstation Phase 2 step 4).
 * Honest copy per contracts §4: the session ended and Machina deliberately
 * does NOT respawn a shell for an agent thread (it would be unattributed).
 * As `overlay` it banners over the webview so the final scrollback stays
 * visible; standalone it replaces the webview entirely.
 */
function DeadSessionState({ overlay }: { readonly overlay?: boolean }) {
  return (
    <div
      role="status"
      data-testid="terminal-dead-state"
      className="te-term-dead"
      data-overlay={overlay ? 'true' : undefined}
    >
      <div className="te-term-dead-eyebrow">agent session ended</div>
      <div className="te-term-dead-body">
        This PTY is gone. Machina does not restart shells for agent threads — send a message to
        start the next turn in a fresh, attributed session.
      </div>
    </div>
  )
}
