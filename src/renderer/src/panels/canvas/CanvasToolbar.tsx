import { useEffect, useRef, useState } from 'react'
import { useCanvasStore } from '../../store/canvas-store'
import { useVaultStore } from '../../store/vault-store'
import { useSettingsStore } from '../../store/settings-store'
import { createCanvasNode } from '@shared/canvas-types'
import { generateClaudeMd } from '../../engine/claude-md-template'
import { TILE_PATTERNS, type TilePattern } from './canvas-tiling'
import { colors } from '../../design/tokens'

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
  const showAllEdges = useCanvasStore((s) => s.showAllEdges)
  const toggleShowAllEdges = useCanvasStore((s) => s.toggleShowAllEdges)
  const gridDotVisibility = useSettingsStore((s) => s.env.gridDotVisibility)
  const cardBlur = useSettingsStore((s) => s.env.cardBlur)
  const setEnv = useSettingsStore((s) => s.setEnv)
  const [tileMenuOpen, setTileMenuOpen] = useState(false)
  const [envMenuOpen, setEnvMenuOpen] = useState(false)
  const tileMenuRef = useRef<HTMLDivElement>(null)
  const envMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!tileMenuOpen && !envMenuOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      if (tileMenuRef.current && !tileMenuRef.current.contains(event.target as Node)) {
        setTileMenuOpen(false)
      }
      if (envMenuRef.current && !envMenuRef.current.contains(event.target as Node)) {
        setEnvMenuOpen(false)
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setTileMenuOpen(false)
        setEnvMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [tileMenuOpen, envMenuOpen])

  const zoomIn = () => setViewport({ ...viewport, zoom: Math.min(3.0, viewport.zoom * 1.2) })
  const zoomOut = () => setViewport({ ...viewport, zoom: Math.max(0.1, viewport.zoom / 1.2) })
  const resetZoom = () => setViewport({ x: 0, y: 0, zoom: 1 })

  const zoomPercent = Math.round(viewport.zoom * 100)

  return (
    <div className="canvas-toolrail absolute top-3 left-3 z-30">
      <button
        onClick={onAddCard}
        className="canvas-toolbtn"
        title="Add card"
        data-testid="canvas-add-card"
        style={{ color: colors.text.secondary }}
      >
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
        className="canvas-toolbtn"
        title="Import notes (Cmd+G)"
        data-testid="canvas-import"
        style={{ color: colors.text.secondary }}
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

      <div className="canvas-toolrail__divider" />

      <button onClick={zoomIn} className="canvas-toolbtn" title="Zoom in">
        +
      </button>
      <button
        onClick={resetZoom}
        className="canvas-toolbtn canvas-zoom-badge"
        title={`${zoomPercent}% (click to reset)`}
      >
        {zoomPercent}%
      </button>
      <button onClick={zoomOut} className="canvas-toolbtn" title="Zoom out">
        -
      </button>

      <div className="canvas-toolrail__divider" />

      <button
        onClick={onUndo}
        className="canvas-toolbtn"
        disabled={!canUndo}
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
        className="canvas-toolbtn"
        disabled={!canRedo}
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

      <div className="canvas-toolrail__divider" />

      <div ref={tileMenuRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setTileMenuOpen((prev) => !prev)}
          className="canvas-toolbtn"
          title="Tile layout (Cmd+L)"
          data-testid="canvas-tile"
        >
          <svg
            width={14}
            height={14}
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <rect x="1" y="1" width="5" height="5" rx="0.5" />
            <rect x="8" y="1" width="5" height="5" rx="0.5" />
            <rect x="1" y="8" width="5" height="5" rx="0.5" />
            <rect x="8" y="8" width="5" height="5" rx="0.5" />
          </svg>
        </button>
        {tileMenuOpen && (
          <div
            className="sidebar-popover absolute flex flex-col py-1"
            style={{
              top: 0,
              left: '100%',
              marginLeft: 6,
              minWidth: 150,
              zIndex: 50
            }}
          >
            <button
              className="sidebar-popover-item"
              style={{ color: colors.text.primary }}
              onClick={() => {
                const vp = useCanvasStore.getState().viewport
                const el = document.querySelector('[data-canvas-surface]')
                const w = el?.clientWidth ?? 1920
                const h = el?.clientHeight ?? 1080
                const centerX = (-vp.x + w / 2) / vp.zoom
                const centerY = (-vp.y + h / 2) / vp.zoom
                const { artifacts, graph, fileToId } = useVaultStore.getState()
                const fileToIdMap = new Map(Object.entries(fileToId))
                const artMap = new Map(artifacts.map((a) => [a.id, { id: a.id, tags: a.tags }]))
                useCanvasStore
                  .getState()
                  .applySemanticLayout({ x: centerX, y: centerY }, fileToIdMap, artMap, graph.edges)
                setTileMenuOpen(false)
              }}
            >
              Organize by topic
            </button>
            <div className="sidebar-popover-divider mx-3 my-1" />
            {TILE_PATTERNS.map((p) => (
              <button
                key={p.id}
                className="sidebar-popover-item"
                style={{ color: colors.text.secondary }}
                onClick={() => {
                  const vp = useCanvasStore.getState().viewport
                  const el = document.querySelector('[data-canvas-surface]')
                  const w = el?.clientWidth ?? 1920
                  const h = el?.clientHeight ?? 1080
                  const centerX = (-vp.x + w / 2) / vp.zoom
                  const centerY = (-vp.y + h / 2) / vp.zoom
                  useCanvasStore.getState().applyTileLayout(p.id as TilePattern, {
                    x: centerX,
                    y: centerY
                  })
                  setTileMenuOpen(false)
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="canvas-toolrail__divider" />

      <button
        onClick={toggleShowAllEdges}
        className={`canvas-toolbtn${showAllEdges ? ' canvas-toolbtn--active' : ''}`}
        title={showAllEdges ? 'Hide edges (show on hover)' : 'Show all edges'}
      >
        <svg
          width={14}
          height={14}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <circle cx="4" cy="4" r="2" />
          <circle cx="12" cy="12" r="2" />
          <line x1="5.5" y1="5.5" x2="10.5" y2="10.5" />
        </svg>
      </button>

      <div className="canvas-toolrail__divider" />

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
        className="canvas-toolbtn canvas-toolbtn--accent"
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

      <div className="canvas-toolrail__divider" />

      <div ref={envMenuRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setEnvMenuOpen((prev) => !prev)}
          className="canvas-toolbtn"
          title="Environment settings"
          data-testid="canvas-env-settings"
        >
          <svg
            width={14}
            height={14}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="8" cy="8" r="3" />
            <line x1="8" y1="1" x2="8" y2="4" />
            <line x1="8" y1="12" x2="8" y2="15" />
            <line x1="1" y1="8" x2="4" y2="8" />
            <line x1="12" y1="8" x2="15" y2="8" />
          </svg>
        </button>
        {envMenuOpen && (
          <div
            className="sidebar-popover absolute flex flex-col gap-3 p-3"
            style={{
              top: 0,
              left: '100%',
              marginLeft: 6,
              minWidth: 180,
              zIndex: 50
            }}
          >
            <div className="flex flex-col gap-1">
              <span
                style={{
                  fontSize: 10,
                  color: colors.text.muted,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase'
                }}
              >
                Grid dots
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={gridDotVisibility}
                onChange={(e) => setEnv('gridDotVisibility', Number(e.target.value))}
                className="graph-slider w-full"
                style={{ accentColor: 'var(--color-text-primary)' }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span
                style={{
                  fontSize: 10,
                  color: colors.text.muted,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase'
                }}
              >
                Card blur
              </span>
              <input
                type="range"
                min={0}
                max={32}
                step={2}
                value={cardBlur}
                onChange={(e) => setEnv('cardBlur', Number(e.target.value))}
                className="graph-slider w-full"
                style={{ accentColor: 'var(--color-text-primary)' }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="canvas-toolrail__divider" />

      <div className="flex w-full flex-col items-center gap-1" style={{ padding: '2px 0' }}>
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
