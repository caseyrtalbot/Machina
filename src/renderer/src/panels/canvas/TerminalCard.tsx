import { useRef, useEffect, useCallback, useState } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useCanvasStore } from '../../store/canvas-store'
import { useVaultStore } from '../../store/vault-store'
import { CardShell } from './CardShell'
import { colors } from '../../design/tokens'
import type { CanvasNode } from '@shared/canvas-types'
import 'xterm/css/xterm.css'

interface TerminalCardProps {
  node: CanvasNode
}

export function TerminalCard({ node }: TerminalCardProps) {
  const termContainerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const sessionIdRef = useRef<string | null>(node.content || null)
  const [sessionDead, setSessionDead] = useState(false)
  const [focused, setFocused] = useState(false)

  const removeNode = useCanvasStore((s) => s.removeNode)
  const updateContent = useCanvasStore((s) => s.updateNodeContent)
  const setFocusedTerminal = useCanvasStore((s) => s.setFocusedTerminal)
  const vaultPath = useVaultStore((s) => s.vaultPath)

  // Create PTY session on mount
  useEffect(() => {
    let sessionId = sessionIdRef.current
    let term: Terminal | null = null
    let cancelled = false

    async function init() {
      if (!sessionId) {
        const cwd = vaultPath || '/'
        sessionId = await window.api.terminal.create(cwd)
        sessionIdRef.current = sessionId
        // Persist session ID in node content
        updateContent(node.id, sessionId)
      }
      if (cancelled) return

      term = new Terminal({
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: 12,
        theme: {
          background: colors.bg.base,
          foreground: colors.text.primary,
          cursor: colors.accent.default,
          selectionBackground: colors.accent.muted
        },
        scrollback: 5000,
        cursorBlink: true
      })
      termRef.current = term

      const fitAddon = new FitAddon()
      fitRef.current = fitAddon
      term.loadAddon(fitAddon)

      if (termContainerRef.current) {
        term.open(termContainerRef.current)

        // Force xterm viewport to fill the container
        const xtermEl = termContainerRef.current.querySelector('.xterm') as HTMLElement | null
        if (xtermEl) {
          xtermEl.style.height = '100%'
        }
        const screenEl = termContainerRef.current.querySelector(
          '.xterm-screen'
        ) as HTMLElement | null
        if (screenEl) {
          screenEl.style.height = '100%'
        }

        fitAddon.fit()
        const { cols, rows } = term
        window.api.terminal.resize(sessionId!, cols, rows)

        // Re-fit after layout settles (flexbox may not have final dimensions yet)
        requestAnimationFrame(() => {
          if (!cancelled) fitAddon.fit()
        })
      }

      term.onData((data) => {
        if (sessionIdRef.current) {
          window.api.terminal.write(sessionIdRef.current, data)
        }
      })
    }

    init()

    return () => {
      cancelled = true
      term?.dispose()
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
    return unsub
  }, [])

  // Listen for terminal exit
  useEffect(() => {
    const unsub = window.api.on.terminalExit(({ sessionId }) => {
      if (sessionId === sessionIdRef.current) {
        termRef.current?.writeln('\r\n[Session ended]')
        setSessionDead(true)
      }
    })
    return unsub
  }, [])

  // Auto-fit on card resize
  useEffect(() => {
    const container = termContainerRef.current
    if (!container) return

    const observer = new ResizeObserver(() => {
      if (fitRef.current && termRef.current) {
        fitRef.current.fit()
        const sessionId = sessionIdRef.current
        if (sessionId) {
          const { cols, rows } = termRef.current
          window.api.terminal.resize(sessionId, cols, rows)
        }
      }
    })

    observer.observe(container)
    return () => observer.disconnect()
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

  const handleRestart = useCallback(async () => {
    const cwd = vaultPath || '/'
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
  }, [node.id, vaultPath, updateContent])

  return (
    <CardShell node={node} title="Terminal" onClose={handleClose}>
      <div
        className="h-full relative"
        onFocus={handleFocus}
        onBlur={handleBlur}
        onClick={(e) => {
          e.stopPropagation()
          handleFocus()
        }}
        tabIndex={-1}
        style={{
          minHeight: 0,
          overflow: 'hidden',
          outline: focused ? `1px solid ${colors.accent.default}` : 'none',
          outlineOffset: -1
        }}
      >
        <div
          ref={termContainerRef}
          className="w-full h-full"
          style={{ padding: '4px 0 0 4px', minHeight: 0 }}
        />
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
