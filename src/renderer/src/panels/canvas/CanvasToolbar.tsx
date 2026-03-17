import { useCanvasStore } from '../../store/canvas-store'
import { useViewStore } from '../../store/view-store'
import { colors, borderRadius } from '../../design/tokens'

interface CanvasToolbarProps {
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly onUndo: () => void
  readonly onRedo: () => void
  readonly onAddCard: () => void
  readonly onOpenImport: () => void
}

export function CanvasToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onAddCard,
  onOpenImport
}: CanvasToolbarProps): React.ReactElement {
  const viewport = useCanvasStore((s) => s.viewport)
  const setViewport = useCanvasStore((s) => s.setViewport)
  const toggleClaudeConfig = useViewStore((s) => s.toggleClaudeConfig)

  const zoomIn = () => setViewport({ ...viewport, zoom: Math.min(3.0, viewport.zoom * 1.2) })
  const zoomOut = () => setViewport({ ...viewport, zoom: Math.max(0.1, viewport.zoom / 1.2) })
  const resetZoom = () => setViewport({ x: 0, y: 0, zoom: 1 })

  const zoomPercent = Math.round(viewport.zoom * 100)

  const btnStyle: React.CSSProperties = {
    color: colors.text.secondary,
    backgroundColor: 'transparent',
    width: 28,
    height: 28,
    borderRadius: borderRadius.inline,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    cursor: 'pointer',
    border: 'none'
  }

  const disabledStyle: React.CSSProperties = {
    ...btnStyle,
    color: colors.text.muted,
    cursor: 'default'
  }

  return (
    <div
      className="absolute top-3 right-3 flex flex-col gap-1 z-30"
      style={{
        backgroundColor: colors.bg.elevated,
        border: `1px solid ${colors.border.default}`,
        borderRadius: borderRadius.card,
        padding: 4
      }}
    >
      <button onClick={onAddCard} style={btnStyle} title="Add card">
        <svg
          width={14}
          height={14}
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <line x1="7" y1="2" x2="7" y2="12" />
          <line x1="2" y1="7" x2="12" y2="7" />
        </svg>
      </button>
      <button onClick={onOpenImport} style={btnStyle} title="Import notes (Cmd+G)">
        <svg
          width={14}
          height={14}
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <circle cx="3" cy="3" r="1.5" />
          <circle cx="11" cy="3" r="1.5" />
          <circle cx="7" cy="11" r="1.5" />
          <line x1="4.2" y1="3.8" x2="5.8" y2="9.8" />
          <line x1="9.8" y1="3.8" x2="8.2" y2="9.8" />
          <line x1="4.5" y1="3" x2="9.5" y2="3" />
        </svg>
      </button>

      <div style={{ height: 1, backgroundColor: colors.border.subtle, margin: '2px 0' }} />

      <button onClick={zoomIn} style={btnStyle} title="Zoom in">
        +
      </button>
      <button
        onClick={resetZoom}
        style={{ ...btnStyle, fontSize: 10 }}
        title={`${zoomPercent}% — click to reset`}
      >
        {zoomPercent}%
      </button>
      <button onClick={zoomOut} style={btnStyle} title="Zoom out">
        -
      </button>

      <div style={{ height: 1, backgroundColor: colors.border.subtle, margin: '2px 0' }} />

      <button onClick={onUndo} style={canUndo ? btnStyle : disabledStyle} title="Undo (Cmd+Z)">
        <svg
          width={14}
          height={14}
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <polyline points="3 7 6 4" />
          <polyline points="3 7 6 10" />
          <path d="M6 7h4a2 2 0 0 1 0 4H8" />
        </svg>
      </button>
      <button
        onClick={onRedo}
        style={canRedo ? btnStyle : disabledStyle}
        title="Redo (Cmd+Shift+Z)"
      >
        <svg
          width={14}
          height={14}
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <polyline points="11 7 8 4" />
          <polyline points="11 7 8 10" />
          <path d="M8 7H4a2 2 0 0 0 0 4h2" />
        </svg>
      </button>

      <div style={{ height: 1, backgroundColor: colors.border.subtle, margin: '2px 0' }} />

      <button
        onClick={toggleClaudeConfig}
        style={{ ...btnStyle, color: '#f59e0b' }}
        title="Claude Config Canvas"
      >
        <svg
          width={14}
          height={14}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
        </svg>
      </button>
    </div>
  )
}
