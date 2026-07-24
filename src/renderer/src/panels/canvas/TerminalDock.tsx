import { useState, useCallback } from 'react'
import { useCanvas } from './canvas-store-context'
import { useTerminalStatus, type TerminalStatus } from './useTerminalStatus'

interface TerminalDockProps {
  readonly containerWidth: number
  readonly containerHeight: number
}

const STORAGE_KEY = 'te-terminal-dock-collapsed'

function TerminalPill({
  status,
  node,
  onNavigate
}: {
  readonly status: TerminalStatus
  readonly node: {
    readonly position: { readonly x: number; readonly y: number }
    readonly size: { readonly width: number; readonly height: number }
    readonly metadata: Readonly<Record<string, unknown>>
  }
  readonly onNavigate: (status: TerminalStatus) => void
}) {
  const isError = status.status === 'error'

  const processLabel =
    status.processName && status.processName !== status.label ? status.processName : ''
  const fullCwd =
    typeof node.metadata?.initialCwd === 'string' ? (node.metadata.initialCwd as string) : ''

  return (
    <div
      data-testid="terminal-pill"
      className="terminal-pill te-termdock-pill"
      data-error={isError ? 'true' : undefined}
      title={fullCwd || status.label}
      onClick={() => onNavigate(status)}
    >
      <div data-testid="status-dot" className="te-termdock-dot" data-status={status.status} />
      <span className="te-termdock-pill-label">{status.label}</span>
      {processLabel && <span className="te-termdock-pill-process">{processLabel}</span>}
    </div>
  )
}

export function TerminalDock({
  containerWidth,
  containerHeight
}: TerminalDockProps): React.ReactElement | null {
  const nodes = useCanvas((s) => s.nodes)
  const setViewport = useCanvas((s) => s.setViewport)
  const setFocusedTerminal = useCanvas((s) => s.setFocusedTerminal)
  const setSelection = useCanvas((s) => s.setSelection)

  const terminalNodes = nodes.filter((n) => n.type === 'terminal')
  const statuses = useTerminalStatus(terminalNodes)

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(STORAGE_KEY) === 'true')

  const handleToggle = useCallback((value: boolean) => {
    setCollapsed(value)
    localStorage.setItem(STORAGE_KEY, String(value))
  }, [])

  const handleNavigate = useCallback(
    (status: TerminalStatus) => {
      if (containerWidth === 0 || containerHeight === 0) return
      const node = nodes.find((n) => n.id === status.nodeId)
      if (!node) return
      const cx = node.position.x + node.size.width / 2
      const cy = node.position.y + node.size.height / 2
      const zoom = 0.8
      setViewport({
        x: containerWidth / 2 - cx * zoom,
        y: containerHeight / 2 - cy * zoom,
        zoom
      })
      setFocusedTerminal(status.nodeId)
      setSelection(new Set([status.nodeId]))
    },
    [nodes, containerWidth, containerHeight, setViewport, setFocusedTerminal, setSelection]
  )

  if (terminalNodes.length === 0) return null

  if (collapsed) {
    return (
      <div className="te-termdock">
        <div
          data-testid="terminal-dock-collapsed"
          className="te-card-enter te-termdock-collapsed"
          onClick={() => handleToggle(false)}
        >
          {statuses.map((s) => (
            <div
              key={s.nodeId}
              data-testid="status-dot"
              className="te-termdock-dot"
              data-status={s.status}
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="te-termdock">
      <div data-testid="terminal-dock-bar" className="te-card-enter te-termdock-bar">
        {statuses.map((s) => {
          const node = terminalNodes.find((n) => n.id === s.nodeId)
          if (!node) return null
          return <TerminalPill key={s.nodeId} status={s} node={node} onNavigate={handleNavigate} />
        })}
      </div>
    </div>
  )
}
