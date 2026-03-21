import { useRef, useEffect, useCallback, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { useCanvasStore } from '../../store/canvas-store'
import { useVaultStore } from '../../store/vault-store'
import { CardShell } from './CardShell'
import { colors } from '../../design/tokens'
import type { CanvasNode } from '@shared/canvas-types'
import { type SessionId, sessionId as toSessionId } from '@shared/types'
import '@xterm/xterm/css/xterm.css'

const BASE_FONT_SIZE = 13

interface TerminalCardProps {
  node: CanvasNode
}

export function TerminalCard({ node }: TerminalCardProps) {
  const termContainerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const webglRef = useRef<WebglAddon | null>(null)
  const sessionIdRef = useRef<SessionId | null>(node.content ? toSessionId(node.content) : null)
  const [sessionDead, setSessionDead] = useState(false)
  const [focused, setFocused] = useState(false)

  const removeNode = useCanvasStore((s) => s.removeNode)
  const updateContent = useCanvasStore((s) => s.updateNodeContent)
  const setFocusedTerminal = useCanvasStore((s) => s.setFocusedTerminal)
  const zoom = useCanvasStore((s) => s.viewport.zoom)
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const initialCwd = typeof node.metadata?.initialCwd === 'string' ? node.metadata.initialCwd : null

  // Create xterm + PTY session on mount.
  // IMPORTANT: xterm must be mounted BEFORE the PTY is created so the
  // terminalData listener can write to it as soon as the shell sends output.
  useEffect(() => {
    let sessionId = sessionIdRef.current
    let cancelled = false

    // Support metadata-driven cwd and initial command
    const initialCommand =
      typeof node.metadata?.initialCommand === 'string' ? node.metadata.initialCommand : null

    // Step 1: Create and mount xterm synchronously
    const term = new Terminal({
      fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", Menlo, monospace',
      fontSize: BASE_FONT_SIZE * useCanvasStore.getState().viewport.zoom,
      lineHeight: 1.2,
      letterSpacing: 0,
      fontWeight: '400',
      fontWeightBold: '600',
      theme: {
        background: '#0c0e14',
        foreground: '#cdd6f4',
        cursor: colors.accent.default,
        cursorAccent: '#0c0e14',
        selectionBackground: 'rgba(0, 229, 191, 0.18)',
        selectionForeground: '#cdd6f4',
        black: '#45475a',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#cba6f7',
        cyan: '#94e2d5',
        white: '#bac2de',
        brightBlack: '#585b70',
        brightRed: '#f38ba8',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#cba6f7',
        brightCyan: '#94e2d5',
        brightWhite: '#a6adc8'
      },
      scrollback: 10000,
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      allowProposedApi: true,
      smoothScrollDuration: 100,
      drawBoldTextInBrightColors: true,
      minimumContrastRatio: 1
    })
    termRef.current = term

    const fitAddon = new FitAddon()
    fitRef.current = fitAddon
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())

    if (termContainerRef.current) {
      term.open(termContainerRef.current)

      // Load WebGL addon for GPU-accelerated rendering (crisper text, like modern terminals).
      // Falls back silently to Canvas 2D if WebGL is unavailable in this context.
      try {
        const webgl = new WebglAddon()
        webgl.onContextLoss(() => {
          webgl.dispose()
          webglRef.current = null
        })
        term.loadAddon(webgl)
        webglRef.current = webgl
      } catch {
        // WebGL unavailable — Canvas 2D renderer remains active
      }

      // Force xterm viewport to fill the container
      const xtermEl = termContainerRef.current.querySelector('.xterm') as HTMLElement | null
      if (xtermEl) {
        xtermEl.style.height = '100%'
      }
      const screenEl = termContainerRef.current.querySelector('.xterm-screen') as HTMLElement | null
      if (screenEl) {
        screenEl.style.height = '100%'
      }

      fitAddon.fit()
    }

    // Wire user keystrokes -> PTY
    term.onData((data) => {
      if (sessionIdRef.current) {
        window.api.terminal.write(sessionIdRef.current, data)
      }
    })

    // Step 2: Create PTY session (async) — xterm is already mounted and
    // the terminalData listener is ready, so no output will be dropped.
    async function createSession() {
      if (!sessionId) {
        const cwd = initialCwd || vaultPath || '/'
        sessionId = await window.api.terminal.create(cwd)
        if (cancelled) return
        sessionIdRef.current = sessionId
        updateContent(node.id, sessionId)
      }

      // Now that we have a session ID, resize PTY to match terminal
      if (termRef.current) {
        const { cols, rows } = termRef.current
        window.api.terminal.resize(sessionId!, cols, rows)
      }

      // Re-fit after layout settles
      requestAnimationFrame(() => {
        if (!cancelled && fitRef.current) fitRef.current.fit()
      })

      // Send initial command after shell has time to initialize
      if (initialCommand && sessionId) {
        setTimeout(() => {
          if (!cancelled && sessionIdRef.current) {
            window.api.terminal.write(sessionIdRef.current, initialCommand + '\n')
          }
        }, 500)
      }
    }

    createSession()

    return () => {
      cancelled = true
      const sid = sessionIdRef.current
      if (sid) {
        window.api.terminal.kill(sid)
      }
      // Dispose WebGL addon explicitly before terminal to avoid
      // _isDisposed crash when DOM is removed before xterm cleanup
      try {
        webglRef.current?.dispose()
      } catch {
        // WebGL context already lost
      }
      webglRef.current = null
      try {
        term.dispose()
      } catch {
        // Terminal already partially disposed
      }
      termRef.current = null
      fitRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for terminal data
  useEffect(() => {
    const unsub = window.api.on.terminalData(({ sessionId, data }) => {
      if (sessionId === sessionIdRef.current) {
        termRef.current?.write(data)
      }
    })
    return () => {
      unsub()
    }
  }, [])

  // Listen for terminal exit
  useEffect(() => {
    const unsub = window.api.on.terminalExit(({ sessionId }) => {
      if (sessionId === sessionIdRef.current) {
        termRef.current?.writeln('\r\n[Session ended]')
        setSessionDead(true)
      }
    })
    return () => {
      unsub()
    }
  }, [])

  // Sync font size with canvas zoom so column count stays consistent.
  // Counter-scale shrinks the container; scaling the font by the same
  // factor keeps the same number of columns while rendering at 1:1 pixels.
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    const targetSize = BASE_FONT_SIZE * zoom
    if (Math.abs(term.options.fontSize! - targetSize) > 0.01) {
      term.options.fontSize = targetSize
    }
  }, [zoom])

  // Auto-fit on card resize and zoom changes (debounced).
  // The counter-scale wrapper sizes the container to zoom*100% of the card,
  // so zoom changes alter clientWidth/Height and trigger re-fit automatically.
  useEffect(() => {
    const container = termContainerRef.current
    if (!container) return

    let trailingId: ReturnType<typeof setTimeout> | null = null
    let lastWidth = container.clientWidth
    let lastHeight = container.clientHeight

    const doFit = () => {
      if (!fitRef.current || !termRef.current) return
      fitRef.current.fit()
      const sessionId = sessionIdRef.current
      if (sessionId) {
        const { cols, rows } = termRef.current
        window.api.terminal.resize(sessionId, cols, rows)
      }
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return

      const w = entry.target.clientWidth
      const h = entry.target.clientHeight
      if (w === lastWidth && h === lastHeight) return
      lastWidth = w
      lastHeight = h

      if (trailingId) clearTimeout(trailingId)
      trailingId = setTimeout(doFit, 150)
    })

    observer.observe(container)
    return () => {
      if (trailingId) clearTimeout(trailingId)
      observer.disconnect()
    }
  }, [])

  // Focus management
  const handleFocus = useCallback(() => {
    setFocused(true)
    setFocusedTerminal(node.id)
    termRef.current?.focus()
  }, [node.id, setFocusedTerminal])

  const handleBlur = useCallback(() => {
    setFocused(false)
    setFocusedTerminal(null)
  }, [setFocusedTerminal])

  const handleClose = useCallback(() => {
    const sessionId = sessionIdRef.current
    if (sessionId) {
      window.api.terminal.kill(sessionId)
    }
    removeNode(node.id)
  }, [node.id, removeNode])

  const handleRestart = async () => {
    const oldSession = sessionIdRef.current
    if (oldSession) {
      window.api.terminal.kill(oldSession)
    }
    const cwd = initialCwd || vaultPath || '/'
    const newSessionId = await window.api.terminal.create(cwd)
    sessionIdRef.current = newSessionId
    updateContent(node.id, newSessionId)
    setSessionDead(false)

    // Re-mount terminal
    if (termContainerRef.current && termRef.current) {
      termRef.current.clear()
      const fitAddon = fitRef.current
      if (fitAddon) fitAddon.fit()
      const { cols, rows } = termRef.current
      window.api.terminal.resize(newSessionId, cols, rows)
    }
  }

  return (
    <CardShell
      node={node}
      title={node.metadata?.initialCommand === 'claude' ? 'Claude Live' : 'Terminal'}
      onClose={handleClose}
    >
      <div
        className="h-full relative"
        onFocus={handleFocus}
        onBlur={handleBlur}
        onClick={(e) => {
          e.stopPropagation()
          handleFocus()
        }}
        onPointerDown={(e) => {
          // Prevent canvas pan/selection from starting when clicking inside terminal
          e.stopPropagation()
        }}
        tabIndex={-1}
        style={{
          minHeight: 0,
          overflow: 'hidden',
          outline: focused ? `1px solid ${colors.accent.default}` : 'none',
          outlineOffset: -1
        }}
      >
        {/* Counter-scale wrapper: render xterm at screen pixel resolution.
            Parent CanvasSurface applies scale(zoom), so we apply scale(1/zoom)
            on a container sized to zoom*100%. The two transforms cancel out,
            giving xterm a 1:1 pixel mapping to the screen. */}
        <div
          style={{
            width: `${zoom * 100}%`,
            height: `${zoom * 100}%`,
            transform: `scale(${1 / zoom})`,
            transformOrigin: '0 0'
          }}
        >
          <div
            ref={termContainerRef}
            className="w-full h-full"
            style={{ padding: '4px 0 0 4px', minHeight: 0 }}
          />
        </div>
        {sessionDead && (
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
        )}
      </div>
    </CardShell>
  )
}

export default TerminalCard
