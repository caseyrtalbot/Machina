import { useCanvasStore } from '../../store/canvas-store'
import { useVaultStore } from '../../store/vault-store'
import { createCanvasNode } from '@shared/canvas-types'
import { generateClaudeMd } from '../../engine/claude-md-template'
import { colors, borderRadius, floatingPanel } from '../../design/tokens'

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
  const focusFrames = useCanvasStore((s) => s.focusFrames)

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
        borderRadius: floatingPanel.borderRadius,
        boxShadow: floatingPanel.shadowCompact,
        backdropFilter: floatingPanel.blur.compact,
        padding: 6
      }}
    >
      <button onClick={onAddCard} style={btnStyle} title="Add card" data-testid="canvas-add-card">
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
      <button
        onClick={onOpenImport}
        style={btnStyle}
        title="Import notes (Cmd+G)"
        data-testid="canvas-import"
      >
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

      <button
        onClick={onUndo}
        style={canUndo ? btnStyle : disabledStyle}
        title="Undo (Cmd+Z)"
        data-testid="canvas-undo"
      >
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
        data-testid="canvas-redo"
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
        onClick={async () => {
          const vaultPath = useVaultStore.getState().vaultPath
          if (!vaultPath) return

          // Ensure CLAUDE.md exists
          const claudeMdPath = `${vaultPath}/CLAUDE.md`
          const exists = await window.api.fs.fileExists(claudeMdPath)
          if (!exists) {
            const vaultName = vaultPath.split('/').pop() ?? 'Vault'
            await window.api.fs.writeFile(claudeMdPath, generateClaudeMd(vaultName))
          }

          // Add a terminal card to the canvas with claude as initial command
          const vp = useCanvasStore.getState().viewport
          const node = createCanvasNode(
            'terminal',
            { x: -vp.x + 200, y: -vp.y + 100 },
            { metadata: { initialCommand: 'claude' } }
          )
          useCanvasStore.getState().addNode(node)
        }}
        style={{ ...btnStyle, color: '#f59e0b' }}
        title="Start Claude"
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

      <div style={{ height: 1, backgroundColor: colors.border.subtle, margin: '2px 0' }} />

      <div className="flex flex-col items-center gap-1" style={{ padding: '2px 0' }}>
        {[1, 2, 3, 4, 5].map((slot) => {
          const filled = String(slot) in focusFrames
          return (
            <button
              key={slot}
              onClick={() => useCanvasStore.getState().jumpToFocusFrame(String(slot))}
              title={`Focus Frame ${slot} (Cmd+${slot})`}
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                border: `1.5px solid ${colors.text.muted}`,
                backgroundColor: filled ? colors.text.muted : 'transparent',
                cursor: 'pointer',
                padding: 0
              }}
            />
          )
        })}
      </div>
    </div>
  )
}
