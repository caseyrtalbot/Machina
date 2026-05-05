import { useState, useCallback } from 'react'
import { useCanvasStore } from '../../store/canvas-store'
import { useTerminalStatus, type TerminalStatus } from './useTerminalStatus'
import {
  colors,
  floatingPanel,
  spacing,
  borderRadius,
  transitions,
  typography
} from '../../design/tokens'

interface TerminalDockProps {
  readonly containerWidth: number
  readonly containerHeight: number
}

const STORAGE_KEY = 'te-terminal-dock-collapsed'

/** Color and animation settings per terminal status */
function dotStyle(status: TerminalStatus['status']): React.CSSProperties {
  const base: React.CSSProperties = {
    width: 6,
    height: 6,
    borderRadius: '50%',
    flexShrink: 0
  }

  switch (status) {
    case 'unknown':
      return { ...base, backgroundColor: colors.text.muted, opacity: 0.5 }
    case 'idle':
      return { ...base, backgroundColor: colors.semantic.cluster }
    case 'busy':
      return {
        ...base,
        backgroundColor: '#60a5fa',
        animation: 'te-dock-pulse 2s ease-in-out infinite',
        boxShadow: '0 0 6px #60a5fa'
      }
    case 'error':
      return {
        ...base,
        backgroundColor: '#ef4444',
        animation: 'te-dock-pulse 1s ease-in-out infinite',
        boxShadow: '0 0 6px #ef4444'
      }
    case 'dead':
      return { ...base, backgroundColor: colors.text.muted }
    case 'claude':
      return {
        ...base,
        backgroundColor: '#00e5bf',
        animation: 'te-dock-pulse 2s ease-in-out infinite',
        boxShadow: '0 0 6px #00e5bf'
      }
  }
}

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
  const [hovered, setHovered] = useState(false)

  const isError = status.status === 'error'

  const pillStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.unit,
    padding: '4px 8px',
    backgroundColor: isError
      ? 'rgba(239, 68, 68, 0.06)'
      : hovered
        ? floatingPanel.glass.inputBgFocus
        : floatingPanel.glass.inputBg,
    border: `1px solid ${isError ? 'rgba(239, 68, 68, 0.15)' : colors.border.subtle}`,
    borderRadius: borderRadius.inline,
    cursor: 'pointer',
    transition: `background ${transitions.hover}`,
    flexShrink: 0
  }

  const processLabel =
    status.processName && status.processName !== status.label ? status.processName : ''
  const fullCwd =
    typeof node.metadata?.initialCwd === 'string' ? (node.metadata.initialCwd as string) : ''

  return (
    <div
      data-testid="terminal-pill"
      className="terminal-pill"
      style={pillStyle}
      title={fullCwd || status.label}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onNavigate(status)}
    >
      <div data-testid="status-dot" style={dotStyle(status.status)} />
      <span
        style={{
          fontFamily: typography.fontFamily.mono,
          fontSize: 12,
          color: colors.text.secondary,
          maxWidth: 120,
          textOverflow: 'ellipsis',
          overflow: 'hidden',
          whiteSpace: 'nowrap'
        }}
      >
        {status.label}
      </span>
      {processLabel && (
        <span
          style={{
            fontFamily: typography.fontFamily.mono,
            fontSize: 11,
            color: colors.text.muted
          }}
        >
          {processLabel}
        </span>
      )}
    </div>
  )
}

export function TerminalDock({
  containerWidth,
  containerHeight
}: TerminalDockProps): React.ReactElement | null {
  const nodes = useCanvasStore((s) => s.nodes)
  const setViewport = useCanvasStore((s) => s.setViewport)
  const setFocusedTerminal = useCanvasStore((s) => s.setFocusedTerminal)
  const setSelection = useCanvasStore((s) => s.setSelection)

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

  const wrapperStyle: React.CSSProperties = {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 25,
    pointerEvents: 'none',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 6
  }

  if (collapsed) {
    return (
      <div style={wrapperStyle}>
        <div
          data-testid="terminal-dock-collapsed"
          className="te-card-enter"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
            pointerEvents: 'auto',
            cursor: 'pointer'
          }}
          onClick={() => handleToggle(false)}
        >
          {statuses.map((s) => (
            <div key={s.nodeId} data-testid="status-dot" style={dotStyle(s.status)} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div style={wrapperStyle}>
      <div
        data-testid="terminal-dock-bar"
        className="te-card-enter"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: 4,
          pointerEvents: 'auto'
        }}
      >
        {statuses.map((s) => {
          const node = terminalNodes.find((n) => n.id === s.nodeId)
          if (!node) return null
          return <TerminalPill key={s.nodeId} status={s} node={node} onNavigate={handleNavigate} />
        })}
      </div>
    </div>
  )
}
