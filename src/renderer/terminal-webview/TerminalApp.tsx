import type {} from './terminal-api'
import { useRef, useEffect, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'

/**
 * Read launch parameters from the webview URL query string.
 * The host (TerminalCard) sets these when constructing the <webview> src.
 */
function readUrlParams(): {
  sessionId: string | null
  cwd: string | null
  initialCommand: string | null
  systemPrompt: string | null
} {
  const params = new URLSearchParams(window.location.search)
  return {
    sessionId: params.get('sessionId'),
    cwd: params.get('cwd'),
    initialCommand: params.get('initialCommand'),
    systemPrompt: params.get('systemPrompt')
  }
}

/**
 * Escape a string for safe embedding inside a $'...' bash literal.
 * Handles single quotes, backslashes, and newlines.
 */
function escapeForBashDollarQuote(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

/**
 * TerminalApp is the xterm.js session lifecycle controller that runs inside
 * each terminal <webview>. It manages the full lifecycle: create/reconnect
 * a PTY session, wire up data flow, handle resize, focus, and cleanup.
 */
export function TerminalApp() {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const webglRef = useRef<WebglAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const dataBufferRef = useRef<string[]>([])

  // Store listener references so we can unsubscribe on cleanup
  const dataListenerRef = useRef<((data: { sessionId: string; data: string }) => void) | null>(null)
  const exitListenerRef = useRef<((data: { sessionId: string; code: number }) => void) | null>(null)

  /**
   * Flush coalesced data buffer to the terminal in a single write.
   * During fast output, the PTY sends hundreds of small chunks per second.
   * A 5ms buffer coalesces ~5-20 events into one write, reducing CPU usage.
   */
  const flushData = useCallback(() => {
    const chunk = dataBufferRef.current.join('')
    dataBufferRef.current = []
    flushTimerRef.current = undefined
    if (chunk && termRef.current) {
      try {
        termRef.current.write(chunk)
      } catch {
        // xterm viewport not yet initialized (dimensions undefined).
        // Re-queue: it will flush on the next cycle once layout completes.
        dataBufferRef.current = [chunk]
        flushTimerRef.current = setTimeout(flushData, 16)
      }
    }
  }, [])

  useEffect(() => {
    const { sessionId: urlSessionId, cwd, initialCommand, systemPrompt } = readUrlParams()
    let cancelled = false

    // ── xterm.js setup ──────────────────────────────────────────────────

    const term = new Terminal({
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      scrollback: 10000,
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      allowProposedApi: true,
      smoothScrollDuration: 100,
      drawBoldTextInBrightColors: true,
      minimumContrastRatio: 1,
      theme: {
        background: '#0c0e14',
        foreground: '#cdd6f4',
        cursor: '#00e5bf',
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
      }
    })
    termRef.current = term

    // ── Addons ──────────────────────────────────────────────────────────

    const fitAddon = new FitAddon()
    fitRef.current = fitAddon
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())

    const searchAddon = new SearchAddon()
    searchRef.current = searchAddon
    term.loadAddon(searchAddon)

    // Cmd+F / Ctrl+F to trigger search
    term.attachCustomKeyEventHandler((e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        searchAddon.findNext('')
        return false
      }
      return true
    })

    if (containerRef.current) {
      term.open(containerRef.current)

      // WebGL addon for GPU-accelerated rendering with canvas fallback
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
      const xtermEl = containerRef.current.querySelector('.xterm') as HTMLElement | null
      if (xtermEl) {
        xtermEl.style.height = '100%'
      }
      const screenEl = containerRef.current.querySelector('.xterm-screen') as HTMLElement | null
      if (screenEl) {
        screenEl.style.height = '100%'
      }

      fitAddon.fit()

      // Show cursor immediately so the terminal looks alive on creation
      term.focus()
    }

    // ── User keystrokes -> PTY ──────────────────────────────────────────

    term.onData((data) => {
      const sid = sessionIdRef.current
      if (sid) {
        window.terminalApi.write({ sessionId: sid, data })
      }
    })

    // ── Data coalescing listener ────────────────────────────────────────

    const handleData = (payload: { sessionId: string; data: string }) => {
      // No sessionId filter: the SessionRouter already ensures only data for
      // this webview's session arrives at this webContents. Filtering here
      // would drop data that arrives before sessionIdRef.current is set
      // (the PTY emits its prompt before the create IPC roundtrip resolves).
      dataBufferRef.current = [...dataBufferRef.current, payload.data]
      if (flushTimerRef.current === undefined) {
        flushTimerRef.current = setTimeout(flushData, 5)
      }
    }
    dataListenerRef.current = handleData
    window.terminalApi.onData(handleData)

    // ── Exit listener ───────────────────────────────────────────────────

    const handleExit = (payload: { sessionId: string; code: number }) => {
      termRef.current?.writeln('\r\n[Session ended]')
      window.terminalApi.sendToHost('session-exited', payload.sessionId, payload.code)
    }
    exitListenerRef.current = handleExit
    window.terminalApi.onExit(handleExit)

    // ── Focus protocol (guest side) ─────────────────────────────────────

    window.terminalApi.onFocus(() => {
      termRef.current?.focus()
    })

    window.terminalApi.onBlur(() => {
      termRef.current?.blur()
    })

    // ── Resize handling ─────────────────────────────────────────────────

    let resizeObserver: ResizeObserver | null = null
    if (containerRef.current) {
      resizeObserver = new ResizeObserver(() => {
        requestAnimationFrame(() => {
          if (cancelled || !fitRef.current || !termRef.current) return
          try {
            fitRef.current.fit()
          } catch {
            return
          }
          const sid = sessionIdRef.current
          if (sid) {
            window.terminalApi.resize({
              sessionId: sid,
              cols: termRef.current.cols,
              rows: termRef.current.rows
            })
          }
        })
      })
      resizeObserver.observe(containerRef.current)
    }

    // ── Session lifecycle ───────────────────────────────────────────────

    async function connectSession() {
      if (cancelled) return

      const cols = termRef.current?.cols || 80
      const rows = termRef.current?.rows || 24

      // Reconnect path: try to reattach to a surviving session
      if (urlSessionId) {
        const result = await window.terminalApi.reconnect({
          sessionId: urlSessionId,
          cols,
          rows
        })
        if (cancelled) return

        if (result) {
          sessionIdRef.current = urlSessionId
          if (result.scrollback) {
            termRef.current?.write(result.scrollback)
          }
          return
        }
      }

      // Create path: spawn a new session at the actual terminal dimensions
      const newSessionId = await window.terminalApi.create({
        cwd: cwd || '/',
        cols,
        rows
      })
      if (cancelled) return

      sessionIdRef.current = newSessionId
      window.terminalApi.sendToHost('session-created', newSessionId)

      // Send initial command after a brief delay to let the shell initialize
      if (initialCommand) {
        setTimeout(() => {
          if (cancelled || !sessionIdRef.current) return

          if (systemPrompt) {
            const escaped = escapeForBashDollarQuote(systemPrompt)
            const cmd = `claude --append-system-prompt $'${escaped}'`
            window.terminalApi.write({ sessionId: sessionIdRef.current, data: cmd + '\r' })
          } else {
            window.terminalApi.write({
              sessionId: sessionIdRef.current,
              data: initialCommand + '\r'
            })
          }
        }, 500)
      }
    }

    // Defer session connection until after layout is complete.
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
        connectSession().catch(() => {
          // Session connection failed — terminal will show empty
        })
      })
    })

    // ── Cleanup ─────────────────────────────────────────────────────────

    return () => {
      cancelled = true

      // Unsubscribe IPC listeners
      if (dataListenerRef.current) {
        window.terminalApi.offData(dataListenerRef.current)
        dataListenerRef.current = null
      }
      if (exitListenerRef.current) {
        window.terminalApi.offExit(exitListenerRef.current)
        exitListenerRef.current = null
      }

      // Clear data buffer / flush timer
      if (flushTimerRef.current !== undefined) {
        clearTimeout(flushTimerRef.current)
        flushTimerRef.current = undefined
      }
      dataBufferRef.current = []

      // Disconnect resize observer
      resizeObserver?.disconnect()

      // Dispose addons and terminal
      try {
        webglRef.current?.dispose()
      } catch {
        // WebGL context already lost
      }
      webglRef.current = null

      try {
        searchRef.current = null
        term.dispose()
      } catch {
        // Terminal already partially disposed
      }
      termRef.current = null
      fitRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        padding: '8px 12px',
        minHeight: 0,
        background: 'rgba(12, 14, 20, 0.85)',
        overflow: 'hidden'
      }}
    />
  )
}
