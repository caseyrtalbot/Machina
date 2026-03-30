import { useRef, useEffect, useCallback, useState, useMemo } from 'react'
import { useCanvasStore } from '../../store/canvas-store'
import { useVaultStore } from '../../store/vault-store'
import { useClaudeContext } from '../../hooks/useClaudeContext'
import { buildCanvasContext } from '../../engine/context-serializer'
import { CardShell } from './CardShell'
import { colors } from '../../design/tokens'
import type { CanvasNode } from '@shared/canvas-types'
import { type SessionId, sessionId as toSessionId } from '@shared/types'

interface TerminalCardProps {
  readonly node: CanvasNode
}

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
  const webviewRef = useRef<HTMLElement | null>(null)

  const isClaudeCard = node.metadata?.initialCommand === 'claude'
  const { contextBadge, markError: _markError } = useClaudeContext(node, isClaudeCard)

  const removeNode = useCanvasStore((s) => s.removeNode)
  const updateContent = useCanvasStore((s) => s.updateNodeContent)
  const setFocusedTerminal = useCanvasStore((s) => s.setFocusedTerminal)
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

    // For Claude cards, build context in the host (has access to canvas store)
    if (node.metadata?.initialCommand === 'claude') {
      const nodes = useCanvasStore.getState().nodes
      const contextFilePath = vaultPath ? `${vaultPath}/.machina/context-${node.id}.txt` : undefined
      const { text } = buildCanvasContext(node.id, nodes, { contextFilePath })
      if (text) params.set('systemPrompt', text)
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
    wv.addEventListener('crashed', handleCrash)
    wv.addEventListener('did-fail-load', handleCrash)

    return () => {
      webviewReadyRef.current = false
      wv.removeEventListener('dom-ready', handleDomReady)
      wv.removeEventListener('ipc-message', handleIpcMessage)
      wv.removeEventListener('crashed', handleCrash)
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
      titleExtra={contextBadge}
    >
      {sessionDead ? (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(12, 14, 20, 0.85)' }}
        >
          <div className="text-center">
            <p className="text-sm mb-2" style={{ color: colors.text.muted }}>
              Terminal crashed
            </p>
            <button
              onClick={handleRestart}
              className="text-xs px-3 py-1 rounded border"
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

export default TerminalCard
