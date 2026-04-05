import type {} from './terminal-api'
import { useRef, useEffect, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
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

function estimateTermSize(container: HTMLDivElement | null): { cols: number; rows: number } {
  const width = container?.clientWidth ?? document.documentElement.clientWidth
  const height = container?.clientHeight ?? document.documentElement.clientHeight
  const charWidth = 7.22
  const cellHeight = 17
  return {
    cols: Math.max(80, Math.floor(width / charWidth)),
    rows: Math.max(24, Math.floor(height / cellHeight))
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
  const searchRef = useRef<SearchAddon | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const dataBufferRef = useRef<string[]>([])
  const initialCommandTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const firstDataRef = useRef(true)
  const reconnectRef = useRef(false)

  // Store listener references so we can unsubscribe on cleanup
  const dataListenerRef = useRef<((data: { sessionId: string; data: string }) => void) | null>(null)
  const exitListenerRef = useRef<((data: { sessionId: string; code: number }) => void) | null>(null)
  const focusListenerRef = useRef<(() => void) | null>(null)
  const blurListenerRef = useRef<(() => void) | null>(null)
  const refreshListenerRef = useRef<(() => void) | null>(null)

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
        const term = termRef.current
        if (firstDataRef.current) {
          firstDataRef.current = false
          if (reconnectRef.current) {
            term.write('\x1b[2J\x1b[H')
          } else {
            term.reset()
          }
        }
        term.write(chunk)
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
    firstDataRef.current = true
    reconnectRef.current = Boolean(urlSessionId)

    // ── xterm.js setup ──────────────────────────────────────────────────

    const estimatedSize = estimateTermSize(containerRef.current)
    const term = new Terminal({
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      cols: estimatedSize.cols,
      rows: estimatedSize.rows,
      scrollback: 200000,
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      allowProposedApi: true,
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

    const unicode11Addon = new Unicode11Addon()
    term.loadAddon(unicode11Addon)
    term.unicode.activeVersion = '11'

    // Cmd+F / Ctrl+F to trigger search
    term.attachCustomKeyEventHandler((e) => {
      if (e.key === 'Enter' && e.shiftKey) {
        if (e.type === 'keydown') {
          const sid = sessionIdRef.current
          if (sid) {
            void window.terminalApi.sendRawKeys({ sessionId: sid, data: '\x1b[13;2u' })
          }
        }
        return false
      }
      if (e.metaKey && e.key === 'f') {
        searchAddon.findNext('')
        return false
      }
      return true
    })

    if (containerRef.current) {
      term.open(containerRef.current)

      // Match the production terminal tile: use WebGL when available to avoid
      // partial paint artifacts during rapid redraws, but fall back silently.
      try {
        const webglAddon = new WebglAddon()
        webglAddon.onContextLoss(() => webglAddon.dispose())
        term.loadAddon(webglAddon)
      } catch {
        // GPU renderer unavailable, DOM renderer remains active.
      }

      // Show cursor immediately so the terminal looks alive on creation
      term.focus()
    }

    if (document.hasFocus()) {
      term.focus()
    }

    const handleWindowFocus = () => {
      termRef.current?.focus()
    }
    window.addEventListener('focus', handleWindowFocus)

    let resizeObserver: ResizeObserver | null = null
    let resizeRaf = 0

    const scheduleFitAndRefresh = () => {
      cancelAnimationFrame(resizeRaf)
      resizeRaf = requestAnimationFrame(() => {
        if (cancelled || !fitRef.current || !termRef.current) return
        try {
          fitRef.current.fit()
          if (termRef.current.rows > 0) {
            termRef.current.refresh(0, termRef.current.rows - 1)
          }
        } catch {
          return
        }
      })
    }

    const handleWindowResize = () => {
      scheduleFitAndRefresh()
    }
    window.addEventListener('resize', handleWindowResize)

    void document.fonts?.ready.then(() => {
      if (!cancelled) {
        scheduleFitAndRefresh()
      }
    })

    // ── User keystrokes -> PTY ──────────────────────────────────────────

    term.onData((data) => {
      const sid = sessionIdRef.current
      if (sid) {
        window.terminalApi.write({ sessionId: sid, data })
      }
    })

    term.onResize(({ cols, rows }) => {
      const sid = sessionIdRef.current
      if (sid) {
        window.terminalApi.resize({ sessionId: sid, cols, rows })
      }
    })

    // ── Data coalescing listener ────────────────────────────────────────

    const handleData = (payload: { sessionId: string; data: string }) => {
      // No sessionId filter: the SessionRouter already ensures only data for
      // this webview's session arrives at this webContents. Filtering here
      // would drop data that arrives before sessionIdRef.current is set
      // (the PTY emits its prompt before the create IPC roundtrip resolves).
      dataBufferRef.current.push(payload.data)
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

    const handleFocus = () => {
      termRef.current?.focus()
    }
    focusListenerRef.current = handleFocus
    window.terminalApi.onFocus(handleFocus)

    const handleBlur = () => {
      termRef.current?.blur()
    }
    blurListenerRef.current = handleBlur
    window.terminalApi.onBlur(handleBlur)

    const handleRefresh = () => {
      scheduleFitAndRefresh()
    }
    refreshListenerRef.current = handleRefresh
    window.terminalApi.onRefresh(handleRefresh)

    // ── Resize handling ─────────────────────────────────────────────────

    if (containerRef.current) {
      resizeObserver = new ResizeObserver((entries) => {
        const { width, height } = entries[0].contentRect
        if (width <= 0 || height <= 0) return

        scheduleFitAndRefresh()
      })
      resizeObserver.observe(containerRef.current)
    }

    // ── Session lifecycle ───────────────────────────────────────────────

    async function connectSession() {
      if (cancelled) return

      const fallbackSize = estimateTermSize(containerRef.current)
      const cols = termRef.current?.cols || fallbackSize.cols
      const rows = termRef.current?.rows || fallbackSize.rows

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
          // Ring buffer provides clean scrollback without alternate-screen
          // artifacts (unlike tmux capture-pane which flattens alt-screen context).
          if (result.scrollback) {
            term.write(result.scrollback)
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
        initialCommandTimerRef.current = setTimeout(() => {
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
            scheduleFitAndRefresh()
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
      if (focusListenerRef.current) {
        window.terminalApi.offFocus(focusListenerRef.current)
        focusListenerRef.current = null
      }
      if (blurListenerRef.current) {
        window.terminalApi.offBlur(blurListenerRef.current)
        blurListenerRef.current = null
      }
      if (refreshListenerRef.current) {
        window.terminalApi.offRefresh(refreshListenerRef.current)
        refreshListenerRef.current = null
      }

      // Clear data buffer / flush timer
      if (flushTimerRef.current !== undefined) {
        clearTimeout(flushTimerRef.current)
        flushTimerRef.current = undefined
      }
      if (initialCommandTimerRef.current !== undefined) {
        clearTimeout(initialCommandTimerRef.current)
        initialCommandTimerRef.current = undefined
      }
      dataBufferRef.current = []

      // Disconnect resize observer
      cancelAnimationFrame(resizeRaf)
      resizeObserver?.disconnect()
      window.removeEventListener('focus', handleWindowFocus)
      window.removeEventListener('resize', handleWindowResize)

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
        minHeight: 0,
        background: '#0c0e14',
        overflow: 'hidden'
      }}
    />
  )
}
