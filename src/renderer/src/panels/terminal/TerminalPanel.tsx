import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { WebglAddon } from '@xterm/addon-webgl'
import { useTerminalStore } from '../../store/terminal-store'
import { useVaultStore } from '../../store/vault-store'
import { TerminalTabs } from './TerminalTabs'
import { generateClaudeMd } from '../../engine/claude-md-template'
import { colors } from '../../design/tokens'
import type { SessionId } from '@shared/types'
import '@xterm/xterm/css/xterm.css'

const FONT_SIZE_DEFAULT = 12
const FONT_SIZE_MIN = 8
const FONT_SIZE_MAX = 28

interface TerminalInstance {
  terminal: Terminal
  fitAddon: FitAddon
  sessionId: SessionId
}

export function TerminalPanel() {
  const containerRef = useRef<HTMLDivElement>(null)
  const instancesRef = useRef<Map<SessionId, TerminalInstance>>(new Map())
  const searchAddonsRef = useRef<Map<SessionId, SearchAddon>>(new Map())
  const activeContainerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [termFontSize, setTermFontSize] = useState(FONT_SIZE_DEFAULT)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const { sessions, activeSessionId, addSession, removeSession } = useTerminalStore()
  const { vaultPath } = useVaultStore()

  const createTerminalInstance = useCallback(async () => {
    const cwd = vaultPath || '/'
    let sessionId: SessionId
    try {
      sessionId = await window.api.terminal.create(cwd)
    } catch (err) {
      setError(
        `Failed to create terminal: ${err instanceof Error ? err.message : String(err)}. ` +
          'Try restarting the app or running: npx electron-rebuild'
      )
      return null
    }
    setError(null)
    const title = `Shell ${sessions.length + 1}`

    addSession({ id: sessionId, title })

    const term = new Terminal({
      fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", Menlo, monospace',
      fontSize: termFontSize,
      lineHeight: 1.2,
      letterSpacing: 0,
      fontWeight: '400',
      fontWeightBold: '600',
      theme: {
        background: colors.bg.base,
        foreground: colors.text.primary,
        cursor: colors.accent.default,
        selectionBackground: colors.accent.muted
      },
      scrollback: 10000,
      cursorBlink: true,
      drawBoldTextInBrightColors: true,
      minimumContrastRatio: 1
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    const searchAddon = new SearchAddon()

    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
    term.loadAddon(searchAddon)

    searchAddonsRef.current.set(sessionId, searchAddon)

    term.onData((data) => {
      window.api.terminal.write(sessionId, data)
    })

    instancesRef.current.set(sessionId, { terminal: term, fitAddon, sessionId })

    return sessionId
  }, [vaultPath, sessions.length, addSession, termFontSize])

  const handleNewTab = useCallback(() => {
    createTerminalInstance()
  }, [createTerminalInstance])

  const claudeSessionActive = useMemo(
    () => sessions.some((s) => s.title.toLowerCase().includes('claude')),
    [sessions]
  )

  const handleActivateClaude = useCallback(async () => {
    if (!vaultPath) return

    // If Claude session already exists, just switch to it
    const existing = sessions.find((s) => s.title.toLowerCase().includes('claude'))
    if (existing) {
      useTerminalStore.getState().setActiveSession(existing.id)
      return
    }

    // Ensure CLAUDE.md exists in the vault
    const claudeMdPath = `${vaultPath}/CLAUDE.md`
    const exists = await window.api.fs.fileExists(claudeMdPath)
    if (!exists) {
      const vaultName = vaultPath.split('/').pop() ?? 'Vault'
      await window.api.fs.writeFile(claudeMdPath, generateClaudeMd(vaultName))
    }

    // Create a new terminal and launch Claude
    const sessionId = await createTerminalInstance()
    if (!sessionId) return

    useTerminalStore.getState().renameSession(sessionId, 'Claude')

    // Wait briefly for shell init, then launch Claude CLI
    setTimeout(() => {
      window.api.terminal.write(sessionId, 'claude\n')
    }, 50)
  }, [vaultPath, sessions, createTerminalInstance])

  // Mount/unmount terminal DOM when active session changes
  useEffect(() => {
    const container = activeContainerRef.current
    if (!container || !activeSessionId) return

    const instance = instancesRef.current.get(activeSessionId)
    if (!instance) return

    // Clear previous content
    container.innerHTML = ''
    instance.terminal.open(container)

    // Load WebGL addon for GPU-accelerated rendering (crisper text, like modern terminals).
    // Falls back silently to Canvas 2D if WebGL is unavailable in this context.
    try {
      instance.terminal.loadAddon(new WebglAddon())
    } catch {
      // WebGL unavailable — Canvas 2D renderer remains active
    }

    instance.fitAddon.fit()
  }, [activeSessionId])

  // Listen for data and exit events from main process
  useEffect(() => {
    const unsubData = window.api.on.terminalData((payload) => {
      const instance = instancesRef.current.get(payload.sessionId)
      if (instance) {
        instance.terminal.write(payload.data)
      }
    })

    const unsubExit = window.api.on.terminalExit((payload) => {
      const instance = instancesRef.current.get(payload.sessionId)
      if (instance) {
        instance.terminal.writeln(`\r\n[Process exited with code ${payload.code}]`)
        instancesRef.current.delete(payload.sessionId)
      }
      searchAddonsRef.current.delete(payload.sessionId)
      removeSession(payload.sessionId)
    })

    return () => {
      unsubData()
      unsubExit()
    }
  }, [removeSession])

  // Auto-fit on resize (throttled: updates during drag without flooding PTY)
  useEffect(() => {
    const container = activeContainerRef.current
    if (!container) return

    let lastFit = 0
    let trailingId: ReturnType<typeof setTimeout> | null = null
    const INTERVAL = 100

    const doFit = () => {
      if (!activeSessionId) return
      const instance = instancesRef.current.get(activeSessionId)
      if (!instance) return

      instance.fitAddon.fit()
      const { cols, rows } = instance.terminal
      window.api.terminal.resize(activeSessionId, cols, rows)
    }

    const observer = new ResizeObserver(() => {
      const now = Date.now()

      // Leading edge: fire immediately if enough time has passed
      if (now - lastFit >= INTERVAL) {
        lastFit = now
        doFit()
      }

      // Trailing edge: always schedule a final fit after events settle
      if (trailingId) clearTimeout(trailingId)
      trailingId = setTimeout(() => {
        lastFit = Date.now()
        doFit()
      }, INTERVAL)
    })

    observer.observe(container)
    return () => {
      if (trailingId) clearTimeout(trailingId)
      observer.disconnect()
    }
  }, [activeSessionId])

  // Keyboard shortcuts: Cmd+F (search), Cmd+=/ Cmd+- (zoom)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!e.metaKey) return

      if (e.key === 'f') {
        e.preventDefault()
        setSearchOpen((prev) => {
          const next = !prev
          if (next) {
            // Focus search input after state update
            setTimeout(() => searchInputRef.current?.focus(), 0)
          }
          return next
        })
        return
      }

      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        setTermFontSize((prev) => Math.min(prev + 1, FONT_SIZE_MAX))
        return
      }

      if (e.key === '-') {
        e.preventDefault()
        setTermFontSize((prev) => Math.max(prev - 1, FONT_SIZE_MIN))
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Apply font size to all terminal instances when termFontSize changes
  useEffect(() => {
    for (const instance of instancesRef.current.values()) {
      instance.terminal.options.fontSize = termFontSize
      instance.fitAddon.fit()
    }
  }, [termFontSize])

  // Run search when query changes
  useEffect(() => {
    if (!activeSessionId || !searchQuery) return
    const addon = searchAddonsRef.current.get(activeSessionId)
    if (addon) {
      addon.findNext(searchQuery)
    }
  }, [searchQuery, activeSessionId])

  const handleCloseTab = useCallback(
    (sessionId: SessionId) => {
      if (sessions.length <= 1) return
      window.api.terminal.kill(sessionId)
      const instance = instancesRef.current.get(sessionId)
      if (instance) {
        instance.terminal.dispose()
        instancesRef.current.delete(sessionId)
      }
      searchAddonsRef.current.delete(sessionId)
      removeSession(sessionId)
    },
    [sessions.length, removeSession]
  )

  // Create initial terminal session on mount (ref guards against Strict Mode double-fire)
  const didInit = useRef(false)
  useEffect(() => {
    if (didInit.current) return
    didInit.current = true
    // Defer to avoid synchronous setState during effect execution
    queueMicrotask(() => {
      createTerminalInstance()
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup all terminals on unmount
  useEffect(() => {
    const instances = instancesRef.current
    return () => {
      for (const [id, instance] of instances) {
        instance.terminal.dispose()
        window.api.terminal.kill(id)
      }
      instances.clear()
    }
  }, [])

  return (
    <div ref={containerRef} className="h-full flex flex-col">
      <TerminalTabs
        onNewTab={handleNewTab}
        onCloseTab={handleCloseTab}
        onActivateClaude={handleActivateClaude}
        claudeSessionActive={claudeSessionActive}
        vaultPath={vaultPath}
      />

      {/* Search bar */}
      {searchOpen && (
        <div
          className="flex items-center gap-2 px-3 py-1 border-b"
          style={{ backgroundColor: colors.bg.surface, borderColor: colors.border.default }}
        >
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const addon = activeSessionId
                  ? searchAddonsRef.current.get(activeSessionId)
                  : undefined
                if (addon && searchQuery) addon.findNext(searchQuery)
              }
              if (e.key === 'Escape') {
                setSearchOpen(false)
                setSearchQuery('')
              }
            }}
            placeholder="Search..."
            className="flex-1 bg-transparent outline-none text-xs"
            style={{ color: colors.text.primary }}
          />
          <button
            onClick={() => {
              setSearchOpen(false)
              setSearchQuery('')
            }}
            className="text-xs"
            style={{ color: colors.text.muted }}
          >
            x
          </button>
        </div>
      )}

      {error ? (
        <div
          className="flex-1 flex items-center justify-center p-4"
          style={{ color: colors.text.muted }}
        >
          <div className="text-center max-w-xs">
            <p className="text-sm mb-2">Terminal unavailable</p>
            <p className="text-xs">{error}</p>
            <button
              onClick={() => {
                setError(null)
                createTerminalInstance()
              }}
              className="mt-3 text-xs px-3 py-1 rounded border"
              style={{ borderColor: colors.border.default, color: colors.text.secondary }}
            >
              Retry
            </button>
          </div>
        </div>
      ) : (
        <div
          ref={activeContainerRef}
          className="flex-1 overflow-hidden"
          style={{ padding: '4px 0 0 8px' }}
        />
      )}
    </div>
  )
}
