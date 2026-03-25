import { useRef, useEffect, useCallback, useState, useMemo } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { useCanvasStore } from '../../store/canvas-store'
import { useVaultStore } from '../../store/vault-store'
import { useClaudeContext } from '../../hooks/useClaudeContext'
import { CardShell } from './CardShell'
import { colors } from '../../design/tokens'
import type { CanvasNode } from '@shared/canvas-types'
import { type SessionId, sessionId as toSessionId } from '@shared/types'
import { TE_DIR } from '@shared/constants'
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
  const isClaudeCard = node.metadata?.initialCommand === 'claude'
  const { contextBadge, markError } = useClaudeContext(node, isClaudeCard)

  const removeNode = useCanvasStore((s) => s.removeNode)
  const updateContent = useCanvasStore((s) => s.updateNodeContent)
  const setFocusedTerminal = useCanvasStore((s) => s.setFocusedTerminal)
  const zoom = useCanvasStore((s) => s.viewport.zoom)
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const initialCwd = typeof node.metadata?.initialCwd === 'string' ? node.metadata.initialCwd : null
  const homePath = window.api.getHomePath?.() ?? ''

  const displayTitle = useMemo(() => {
    if (node.metadata?.initialCommand === 'claude') return 'Claude Live'
    if (!initialCwd) return 'Terminal'
    if (homePath && initialCwd.startsWith(homePath)) {
      return '~' + initialCwd.slice(homePath.length)
    }
    return initialCwd
  }, [initialCwd, node.metadata?.initialCommand, homePath])

  // Create xterm + PTY session on mount.
  // IMPORTANT: xterm must be mounted BEFORE the PTY is created so the
  // terminalData listener can write to it as soon as the shell sends output.
  useEffect(() => {
    const existingSessionId = sessionIdRef.current
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

    // Step 2: Connect to a session (async). If we have an existing session ID,
    // try to reconnect (tmux replay). Otherwise create a fresh session.
    async function connectSession() {
      let sessionId = existingSessionId

      // Reconnect path: try to reattach to a surviving tmux session
      if (sessionId && termRef.current) {
        // Ensure xterm has real dimensions before reconnecting.
        // fitAddon.fit() may not have run yet if the card hasn't laid out.
        if (fitRef.current) {
          try {
            fitRef.current.fit()
          } catch {
            // Container not yet sized — use defaults
          }
        }
        const cols = termRef.current.cols || 80
        const rows = termRef.current.rows || 24
        const result = await window.api.terminal.reconnect(sessionId, cols, rows)
        if (cancelled) return

        if (result) {
          // Success: replay scrollback and wire live data
          sessionIdRef.current = sessionId
          if (result.scrollback) {
            termRef.current.write(result.scrollback)
          }
          requestAnimationFrame(() => {
            if (!cancelled && fitRef.current) fitRef.current.fit()
          })
          return
        }

        // Reconnect failed: session is gone, fall through to create
        sessionIdRef.current = null
        sessionId = null
      }

      // Create path: spawn a new session
      const cwd = initialCwd || vaultPath || '/'
      sessionId = await window.api.terminal.create(cwd)
      if (cancelled) return
      sessionIdRef.current = sessionId
      updateContent(node.id, sessionId)

      // Send initial command ONLY for new sessions
      if (initialCommand) {
        setTimeout(() => {
          if (cancelled || !sessionIdRef.current) return

          // For Claude cards: inject canvas file paths as context
          if (isClaudeCard) {
            import('../../engine/context-serializer')
              .then(({ buildCanvasContext, escapeForShell }) => {
                if (cancelled || !sessionIdRef.current) return
                const nodes = useCanvasStore.getState().nodes
                const contextFilePath = vaultPath
                  ? `${vaultPath}/${TE_DIR}/context-${node.id}.txt`
                  : undefined
                const { text } = buildCanvasContext(node.id, nodes, { contextFilePath })
                if (text) {
                  const escaped = escapeForShell(text)
                  const cmd = `claude --append-system-prompt $'${escaped}'`
                  window.api.terminal.write(sessionIdRef.current!, cmd + '\n')
                } else {
                  window.api.terminal.write(sessionIdRef.current!, 'claude\n')
                }
              })
              .catch((err) => {
                console.error('Context injection failed:', err)
                if (sessionIdRef.current) {
                  window.api.terminal.write(sessionIdRef.current, 'claude\n')
                }
                markError()
              })
          } else {
            window.api.terminal.write(sessionIdRef.current!, initialCommand + '\n')
          }
        }, 500)
      }

      // Resize to match xterm dimensions
      if (termRef.current) {
        const { cols, rows } = termRef.current
        window.api.terminal.resize(sessionId!, cols, rows)
      }

      requestAnimationFrame(() => {
        if (!cancelled && fitRef.current) fitRef.current.fit()
      })
    }

    // Defer session connection until after the browser has laid out the card.
    // xterm's viewport crashes if written to before it has real dimensions.
    // Double-rAF ensures: rAF1 = layout computed, rAF2 = xterm internals ready.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return
        if (fitRef.current) {
          try {
            fitRef.current.fit()
          } catch {
            // Container might still be zero-sized
          }
        }
        connectSession()
      })
    })

    // Cleanup: dispose xterm but do NOT kill the session.
    // Sessions survive unmount (tmux detach happens via shutdown() on quit).
    // Only the explicit Close button calls terminal.kill().
    return () => {
      cancelled = true
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

  // Listen for terminal data — coalesce rapid writes into single term.write() calls.
  // During fast output (npm install, cargo build), the PTY sends hundreds of small
  // chunks per second. Each term.write() triggers xterm parse + render scheduling.
  // A 5ms buffer coalesces ~5-20 events into one write, reducing CPU by 40-60%.
  useEffect(() => {
    let dataBuffer: string[] = []
    let flushTimer: ReturnType<typeof setTimeout> | undefined

    const flushData = () => {
      const chunk = dataBuffer.join('')
      dataBuffer = []
      flushTimer = undefined
      if (chunk && termRef.current) {
        try {
          termRef.current.write(chunk)
        } catch {
          // xterm viewport not yet initialized (dimensions undefined).
          // Data arrives from tmux redraw before the card is laid out.
          // Re-queue: it will flush on the next cycle once layout completes.
          dataBuffer.push(chunk)
          flushTimer = setTimeout(flushData, 16)
        }
      }
    }

    const unsub = window.api.on.terminalData(({ sessionId, data }) => {
      if (sessionId !== sessionIdRef.current) return
      dataBuffer.push(data)
      if (flushTimer === undefined) {
        flushTimer = setTimeout(flushData, 5)
      }
    })

    return () => {
      unsub()
      if (flushTimer !== undefined) clearTimeout(flushTimer)
      // Flush any remaining data
      if (dataBuffer.length > 0 && termRef.current) {
        termRef.current.write(dataBuffer.join(''))
      }
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
    <CardShell node={node} title={displayTitle} onClose={handleClose} titleExtra={contextBadge}>
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
          boxShadow: focused
            ? `0 0 0 1.5px ${colors.accent.default}, 0 0 12px rgba(0, 229, 191, 0.15)`
            : undefined
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
            style={{
              padding: '8px 12px',
              minHeight: 0,
              background: 'rgba(12, 14, 20, 0.85)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)'
            }}
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
