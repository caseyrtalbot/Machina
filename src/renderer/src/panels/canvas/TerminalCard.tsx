import { useRef, useEffect, useCallback, useState, useMemo, memo } from 'react'
import { useCanvasStore } from '../../store/canvas-store'
import { useBlockStore } from '../../store/block-store'
import { useVaultStore } from '../../store/vault-store'
import { useClaudeContext } from '../../hooks/useClaudeContext'
import { useClaudeStatus } from '../../hooks/use-claude-status'
import { useCliAgentPresence } from '../../hooks/use-cli-agent-presence'
import { CliAgentBadge } from '../../components/CliAgentBadge'
import { buildCanvasContext } from '../../engine/context-serializer'
import { buildBlockProjection, pickPinnableBlock } from './block-pin'
import { CardShell } from './CardShell'
import { borderRadius, colors } from '../../design/tokens'
import type { CanvasNode } from '@shared/canvas-types'
import type { Block } from '@shared/engine/block-model'
import { type SessionId, sessionId as toSessionId } from '@shared/types'

interface TerminalCardProps {
  readonly node: CanvasNode
}

const EMPTY_BLOCKS: readonly Block[] = []

// ── Resolved terminal theme ──────────────────────────────────────────────
// The webview has no access to the app's CSS vars, so resolve accent/bg to
// hexes once (vars are static at runtime) and pass them as URL params.

let cachedTermTheme: { accent: string; bg: string } | null = null

function getResolvedTermTheme(): { accent: string; bg: string } {
  if (cachedTermTheme === null) {
    const style = getComputedStyle(document.documentElement)
    cachedTermTheme = {
      accent: style.getPropertyValue('--color-accent-default').trim(),
      bg: style.getPropertyValue('--color-bg-base').trim()
    }
  }
  return cachedTermTheme
}

// ── Shell-hook nudge ─────────────────────────────────────────────────────
// When a session produces no prompt-start block within 5s and the hooks are
// not installed, the first terminal to notice offers one-click setup.

const HOOK_BANNER_DISMISSED_KEY = 'te:hook-banner-dismissed'
const HOOK_BANNER_DELAY_MS = 5000

/** Only one terminal card per app run shows the banner. */
let hookBannerClaimed = false

type HookBannerState = 'hidden' | 'offer' | 'installing' | 'installed' | 'error'

type TerminalWebviewElement = HTMLElement & {
  focus: () => void
  send: (channel: string) => void
  sendInputEvent?: (event: {
    type: 'mouseDown' | 'mouseUp'
    x: number
    y: number
    button: 'left'
    clickCount: number
  }) => void
}

function forwardClickToWebview(webview: TerminalWebviewElement, mouseEvent: MouseEvent): void {
  if (!webview.sendInputEvent) return

  const rect = webview.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return

  const x = Math.round((mouseEvent.clientX - rect.left) * (webview.offsetWidth / rect.width))
  const y = Math.round((mouseEvent.clientY - rect.top) * (webview.offsetHeight / rect.height))
  if (x < 0 || y < 0) return
  if (x > webview.offsetWidth || y > webview.offsetHeight) return

  webview.sendInputEvent({
    type: 'mouseDown',
    x,
    y,
    button: 'left',
    clickCount: 1
  })
  webview.sendInputEvent({
    type: 'mouseUp',
    x,
    y,
    button: 'left',
    clickCount: 1
  })
}

export function TerminalCard({ node }: TerminalCardProps) {
  const sessionIdRef = useRef<SessionId | null>(node.content ? toSessionId(node.content) : null)
  const actionInFlight = useRef(false)
  const webviewReadyRef = useRef(false)
  const shouldFocusRef = useRef(false)
  const [launchSessionId, setLaunchSessionId] = useState(node.content)
  const [sessionDead, setSessionDead] = useState(false)
  const [webviewKey, setWebviewKey] = useState(0)
  const [hookBanner, setHookBanner] = useState<HookBannerState>('hidden')
  const webviewRef = useRef<HTMLElement | null>(null)

  const isClaudeCard = node.metadata?.initialCommand === 'claude' || !!node.metadata?.actionId
  const { contextBadge, markError: _markError } = useClaudeContext(node, isClaudeCard)
  const claudeStatus = useClaudeStatus()
  const agentPresence = useCliAgentPresence()
  const sessionAgent = node.content ? (agentPresence[node.content] ?? null) : null

  const removeNode = useCanvasStore((s) => s.removeNode)
  const updateContent = useCanvasStore((s) => s.updateNodeContent)
  const addNode = useCanvasStore((s) => s.addNode)
  const setFocusedTerminal = useCanvasStore((s) => s.setFocusedTerminal)
  const sessionBlocks = useBlockStore((s) =>
    node.content ? (s.blocksBySession[node.content] ?? EMPTY_BLOCKS) : EMPTY_BLOCKS
  )
  const isFocused = useCanvasStore((s) => s.focusedCardId === node.id)
  const isLocked = useCanvasStore((s) => s.lockedCardId === node.id)
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const initialCwd = typeof node.metadata?.initialCwd === 'string' ? node.metadata.initialCwd : null
  const homePath = window.api.getHomePath?.() ?? ''
  shouldFocusRef.current = isFocused || isLocked

  const displayTitle = useMemo(() => {
    if (node.metadata?.initialCommand === 'claude') return 'Claude Live'
    if (!initialCwd) return 'Terminal'
    if (homePath && initialCwd.startsWith(homePath)) {
      return '~' + initialCwd.slice(homePath.length)
    }
    return initialCwd
  }, [initialCwd, node.metadata?.initialCommand, homePath])

  // ── Preload path ────────────────────────────────────────────────────────

  const preloadPath = useMemo(() => 'file://' + window.api.getTerminalPreloadPath(), [])

  // ── Webview src URL ─────────────────────────────────────────────────────

  const webviewSrc = useMemo(() => {
    const params = new URLSearchParams()
    if (launchSessionId) params.set('sessionId', launchSessionId)
    if (node.metadata?.initialCwd) {
      params.set('cwd', String(node.metadata.initialCwd))
    }
    if (node.metadata?.initialCommand) {
      params.set('initialCommand', String(node.metadata.initialCommand))
    }
    if (node.metadata?.actionId) {
      params.set('label', String(node.metadata.actionId))
    }
    if (vaultPath) {
      params.set('vaultPath', vaultPath)
    }

    // Resolved theme hexes so cursor/selection match the app accent.
    const theme = getResolvedTermTheme()
    if (theme.accent) params.set('accent', theme.accent)
    if (theme.bg) params.set('bg', theme.bg)

    // For Claude cards, build context in the host (has access to canvas store)
    if (node.metadata?.initialCommand === 'claude') {
      if (node.metadata?.actionId) {
        // Action terminal: prompt is in a file, initialCommand has the full launch cmd.
        // No systemPrompt URL param needed — the command reads from file directly.
      } else {
        // Regular Claude live card: canvas context
        const nodes = useCanvasStore.getState().nodes
        const contextFilePath = vaultPath
          ? `${vaultPath}/.machina/context-${node.id}.txt`
          : undefined
        const { text } = buildCanvasContext(node.id, nodes, { contextFilePath })
        if (text) params.set('systemPrompt', text)
      }
    }

    // Dev vs prod URL construction.
    // In dev, electron-vite serves renderer entries via a dev server.
    // The main renderer uses ELECTRON_RENDERER_URL (e.g. http://localhost:5173).
    // Multi-page entries are served at /terminal-webview/index.html under the same origin.
    // In prod, use a relative file path from the current renderer location.
    const base = import.meta.env.DEV
      ? new URL('/terminal-webview/index.html', window.location.origin).href
      : new URL('./terminal-webview/index.html', window.location.href).href

    const qs = params.toString()
    return qs ? `${base}?${qs}` : base
  }, [
    launchSessionId,
    node.id,
    node.metadata?.actionId,
    node.metadata?.initialCwd,
    node.metadata?.initialCommand,
    vaultPath
  ])

  useEffect(() => {
    sessionIdRef.current = node.content ? toSessionId(node.content) : null
    if (!webviewReadyRef.current || !sessionIdRef.current) {
      setLaunchSessionId(node.content)
    }
  }, [node.content])

  // ── Webview event listeners ─────────────────────────────────────────────

  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return
    const webview = wv as TerminalWebviewElement
    webviewReadyRef.current = false

    const handleIpcMessage = (event: Event): void => {
      const ipcEvent = event as Event & {
        readonly channel: string
        readonly args: readonly unknown[]
      }
      if (ipcEvent.channel === 'session-created') {
        const newSessionId = String(ipcEvent.args[0])
        sessionIdRef.current = toSessionId(newSessionId)
        updateContent(node.id, newSessionId)
      } else if (ipcEvent.channel === 'session-exited') {
        // Normal PTY exit (user typed `exit`, process ended): show the
        // dead-session overlay so the card offers a restart.
        setSessionDead(true)
      }
    }

    const handleDomReady = (): void => {
      webviewReadyRef.current = true
      if (shouldFocusRef.current) {
        webview.focus()
      }
      try {
        webview.send(shouldFocusRef.current ? 'focus' : 'blur')
      } catch {
        /* webview still warming up */
      }
    }

    const handleCrash = (): void => {
      webviewReadyRef.current = false
      setSessionDead(true)
    }

    wv.addEventListener('dom-ready', handleDomReady)
    wv.addEventListener('ipc-message', handleIpcMessage)
    // Electron 39: renderer crashes surface as 'render-process-gone'
    // (the legacy 'crashed' event no longer exists on <webview>).
    wv.addEventListener('render-process-gone', handleCrash)
    wv.addEventListener('did-fail-load', handleCrash)

    return () => {
      webviewReadyRef.current = false
      wv.removeEventListener('dom-ready', handleDomReady)
      wv.removeEventListener('ipc-message', handleIpcMessage)
      wv.removeEventListener('render-process-gone', handleCrash)
      wv.removeEventListener('did-fail-load', handleCrash)
    }
  }, [node.id, updateContent, webviewKey])

  // ── Focus protocol ──────────────────────────────────────────────────────

  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return
    const webview = wv as TerminalWebviewElement

    if (isFocused || isLocked) {
      webview.focus()
    }

    if (!webviewReadyRef.current) return

    try {
      webview.send(isFocused || isLocked ? 'focus' : 'blur')
    } catch {
      webviewReadyRef.current = false
    }
  }, [isFocused, isLocked, webviewKey])

  useEffect(() => {
    const handleResizeEnd = (event: Event) => {
      const resizeEvent = event as CustomEvent<{ nodeId?: string }>
      if (resizeEvent.detail?.nodeId !== node.id) return

      const wv = webviewRef.current
      if (!wv) return
      const webview = wv as TerminalWebviewElement

      if (isFocused || isLocked) {
        webview.focus()
      }

      if (!webviewReadyRef.current) return

      try {
        webview.send('refresh')
        webview.send(isFocused || isLocked ? 'focus' : 'blur')
      } catch {
        webviewReadyRef.current = false
      }
    }

    window.addEventListener('canvas:node-resize-end', handleResizeEnd as EventListener)
    return () => {
      window.removeEventListener('canvas:node-resize-end', handleResizeEnd as EventListener)
    }
  }, [isFocused, isLocked, node.id, webviewKey])

  useEffect(() => {
    if (isFocused || isLocked) {
      setFocusedTerminal(node.id)
    } else if (useCanvasStore.getState().focusedTerminalId === node.id) {
      setFocusedTerminal(null)
    }

    return () => {
      if (useCanvasStore.getState().focusedTerminalId === node.id) {
        setFocusedTerminal(null)
      }
    }
  }, [isFocused, isLocked, node.id, setFocusedTerminal])

  // ── Shell-hook banner ───────────────────────────────────────────────────

  useEffect(() => {
    const sid = node.content
    if (!sid || sessionDead || hookBannerClaimed) return
    if (localStorage.getItem(HOOK_BANNER_DISMISSED_KEY)) return

    let cancelled = false
    const timer = setTimeout(() => {
      if (cancelled || hookBannerClaimed) return
      // A prompt-start within the window means the hooks are live.
      const blocks = useBlockStore.getState().blocksBySession[sid]
      if (blocks && blocks.length > 0) return
      void window.api.shell
        .hooksStatus()
        .then((status) => {
          if (cancelled || hookBannerClaimed || status.installed) return
          hookBannerClaimed = true
          setHookBanner('offer')
        })
        .catch(() => {
          // Status unavailable — skip the nudge rather than mis-advise.
        })
    }, HOOK_BANNER_DELAY_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [node.content, sessionDead])

  // Hooks emitting after all (manual install under another name): retract.
  useEffect(() => {
    if (hookBanner === 'offer' && sessionBlocks.length > 0) {
      setHookBanner('hidden')
    }
  }, [hookBanner, sessionBlocks.length])

  const handleInstallHooks = useCallback(async () => {
    setHookBanner('installing')
    try {
      const result = await window.api.shell.installHooks()
      setHookBanner(result.ok ? 'installed' : 'error')
    } catch {
      setHookBanner('error')
    }
  }, [])

  const handleDismissHookBanner = useCallback(() => {
    localStorage.setItem(HOOK_BANNER_DISMISSED_KEY, '1')
    setHookBanner('hidden')
  }, [])

  // ── Close handler ───────────────────────────────────────────────────────

  const handleClose = useCallback(() => {
    if (actionInFlight.current) return
    actionInFlight.current = true
    const sid = sessionIdRef.current
    if (sid) {
      window.api.terminal.kill(sid)
    }
    if (useCanvasStore.getState().focusedTerminalId === node.id) {
      setFocusedTerminal(null)
    }
    removeNode(node.id)
    actionInFlight.current = false
  }, [node.id, removeNode, setFocusedTerminal])

  // ── Restart handler ─────────────────────────────────────────────────────

  const handleRestart = useCallback(async () => {
    if (actionInFlight.current) return
    actionInFlight.current = true
    try {
      const sid = sessionIdRef.current
      if (sid) {
        await window.api.terminal.kill(sid)
      }
      sessionIdRef.current = null
      webviewReadyRef.current = false
      setLaunchSessionId('')
      updateContent(node.id, '')
      setSessionDead(false)
      setWebviewKey((k) => k + 1)
    } finally {
      actionInFlight.current = false
    }
  }, [node.id, updateContent])

  const handlePinLatestBlock = useCallback(() => {
    const block = pickPinnableBlock(sessionBlocks)
    if (!block) return
    const projection = buildBlockProjection(node, block)
    addNode(projection)
    useCanvasStore.getState().markRecentlyPinned(projection.id)
  }, [sessionBlocks, node, addNode])

  const handleActivateContentClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const wv = webviewRef.current
    if (!wv) return

    const webview = wv as TerminalWebviewElement
    webview.focus()

    if (!webviewReadyRef.current) return

    try {
      webview.send('focus')
    } catch {
      webviewReadyRef.current = false
      return
    }

    forwardClickToWebview(webview, event.nativeEvent)
  }, [])

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <CardShell
      node={node}
      title={displayTitle}
      onClose={handleClose}
      onActivateContentClick={handleActivateContentClick}
      headerActions={
        sessionBlocks.length > 0 ? (
          <button
            type="button"
            data-testid="terminal-pin-block"
            onClick={(e) => {
              e.stopPropagation()
              handlePinLatestBlock()
            }}
            title="Pin latest block to canvas"
            className="canvas-card__action-btn flex items-center justify-center"
            style={{
              width: 24,
              height: 24,
              fontSize: 11,
              borderRadius: borderRadius.tool,
              color: colors.text.muted,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer'
            }}
          >
            ⊕
          </button>
        ) : null
      }
      titleExtra={
        <>
          {sessionAgent ? <CliAgentBadge presence={sessionAgent} /> : null}
          {isClaudeCard && (!claudeStatus.installed || !claudeStatus.authenticated) ? (
            <span
              className="flex items-center gap-1 text-[10px]"
              style={{ color: colors.claude.warning }}
            >
              <span
                className="inline-block rounded-full"
                style={{ width: 5, height: 5, backgroundColor: colors.claude.warning }}
              />
              {!claudeStatus.installed ? 'CLI not found' : 'Not signed in'}
            </span>
          ) : (
            contextBadge
          )}
        </>
      }
    >
      {!sessionDead && hookBanner !== 'hidden' ? (
        <div
          data-testid="terminal-hook-banner"
          className="absolute left-2 right-2 bottom-2 z-10 flex items-center gap-2 px-3 py-2 text-xs"
          style={{
            background: 'rgba(12, 14, 20, 0.92)',
            border: `1px solid ${colors.border.default}`,
            borderRadius: borderRadius.tool,
            color: colors.text.muted
          }}
        >
          <span className="flex-1 min-w-0">
            {hookBanner === 'offer' &&
              'Enable structured blocks: install the Machina shell hooks to capture commands on the canvas.'}
            {hookBanner === 'installing' && 'Installing shell hooks…'}
            {hookBanner === 'installed' &&
              'Shell hooks installed. New terminals (or `exec $SHELL`) emit structured blocks.'}
            {hookBanner === 'error' &&
              'Hook install failed. See resources/shell-hooks for manual setup.'}
          </span>
          {hookBanner === 'offer' ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                void handleInstallHooks()
              }}
              className="shrink-0 cursor-pointer"
              style={{
                background: 'transparent',
                border: 'none',
                color: colors.accent.default,
                fontSize: 11
              }}
            >
              Set up
            </button>
          ) : null}
          <button
            type="button"
            title="Dismiss"
            onClick={(e) => {
              e.stopPropagation()
              handleDismissHookBanner()
            }}
            className="shrink-0 cursor-pointer"
            style={{
              background: 'transparent',
              border: 'none',
              color: colors.text.muted,
              fontSize: 12
            }}
          >
            ×
          </button>
        </div>
      ) : null}
      {sessionDead ? (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(12, 14, 20, 0.85)' }}
        >
          <div className="text-center">
            <p className="text-sm mb-2" style={{ color: colors.text.muted }}>
              Session ended
            </p>
            <button
              onClick={handleRestart}
              className="text-xs px-3 py-1 border"
              style={{
                borderColor: colors.border.default,
                color: colors.accent.default
              }}
            >
              Restart
            </button>
          </div>
        </div>
      ) : (
        /* eslint-disable react/no-unknown-property */
        <webview
          key={webviewKey}
          ref={webviewRef as React.RefObject<never>}
          src={webviewSrc}
          preload={preloadPath}
          style={{
            width: '100%',
            height: '100%',
            pointerEvents: isFocused || isLocked ? 'auto' : 'none'
          }}
          webpreferences="contextIsolation=yes, sandbox=yes"
        />
        /* eslint-enable react/no-unknown-property */
      )}
    </CardShell>
  )
}

export default memo(TerminalCard)
