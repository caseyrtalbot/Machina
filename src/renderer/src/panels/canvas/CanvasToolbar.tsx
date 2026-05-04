import { useEffect, useRef, useState } from 'react'
import {
  Import,
  LayoutDashboard,
  LayoutGrid,
  Minus,
  Plus,
  Redo2,
  SlidersHorizontal,
  Spline,
  Trash2,
  Undo2,
  type LucideIcon
} from 'lucide-react'
import { useCanvasStore } from '../../store/canvas-store'
import { useVaultStore } from '../../store/vault-store'
import { useSettingsStore } from '../../store/settings-store'
import { TILE_PATTERNS, type TilePattern } from './canvas-tiling'
import { colors, zIndex } from '../../design/tokens'

interface CanvasToolbarProps {
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly onUndo: () => void
  readonly onRedo: () => void
  readonly onAddCard: () => void
  readonly onOpenImport: () => void
  readonly onOrganize: () => void
  readonly organizePhase: string
  readonly onClear: () => void
}

const ICON_SIZE = 16
const ICON_STROKE = 1.75

function Tip({
  label,
  shortcut
}: {
  readonly label: string
  readonly shortcut?: string
}): React.ReactElement {
  return (
    <span className="canvas-tooltip">
      {label}
      {shortcut && <span className="canvas-tooltip__shortcut">{shortcut}</span>}
    </span>
  )
}

function ToolIcon({ icon: Icon }: { readonly icon: LucideIcon }): React.ReactElement {
  return <Icon size={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden />
}

/** Compute the canvas-space point at the center of the visible surface. */
function getViewportCenter(): { x: number; y: number } {
  const vp = useCanvasStore.getState().viewport
  const el = document.querySelector('[data-canvas-surface]')
  const w = el?.clientWidth ?? 1920
  const h = el?.clientHeight ?? 1080
  return {
    x: (-vp.x + w / 2) / vp.zoom,
    y: (-vp.y + h / 2) / vp.zoom
  }
}

/** Surface dimensions in CSS pixels; falls back to a sensible default for tests. */
function getSurfaceSize(): { width: number; height: number } {
  const el = document.querySelector('[data-canvas-surface]')
  return {
    width: el?.clientWidth ?? 1920,
    height: el?.clientHeight ?? 1080
  }
}

/** Compute a viewport that fits the given nodes inside the surface with padding. */
function fitViewportToNodes(
  nodes: ReadonlyArray<{
    position: { x: number; y: number }
    size: { width: number; height: number }
  }>,
  surface: { width: number; height: number }
): { x: number; y: number; zoom: number } {
  if (nodes.length === 0) return { x: 0, y: 0, zoom: 1 }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.position.x)
    minY = Math.min(minY, n.position.y)
    maxX = Math.max(maxX, n.position.x + n.size.width)
    maxY = Math.max(maxY, n.position.y + n.size.height)
  }

  const contentW = Math.max(1, maxX - minX)
  const contentH = Math.max(1, maxY - minY)
  const pad = 80

  const zoomX = (surface.width - pad * 2) / contentW
  const zoomY = (surface.height - pad * 2) / contentH
  const zoom = Math.min(Math.max(Math.min(zoomX, zoomY), 0.1), 1)

  const cx = minX + contentW / 2
  const cy = minY + contentH / 2
  const x = surface.width / 2 - cx * zoom
  const y = surface.height / 2 - cy * zoom

  return { x, y, zoom }
}

export function CanvasToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onAddCard,
  onOpenImport,
  onOrganize,
  organizePhase,
  onClear
}: CanvasToolbarProps): React.ReactElement {
  const viewport = useCanvasStore((s) => s.viewport)
  const setViewport = useCanvasStore((s) => s.setViewport)
  const focusFrames = useCanvasStore((s) => s.focusFrames)
  const selectedNodeIds = useCanvasStore((s) => s.selectedNodeIds)
  const nodes = useCanvasStore((s) => s.nodes)
  const hasNodes = nodes.length > 0
  const showAllEdges = useCanvasStore((s) => s.showAllEdges)
  const toggleShowAllEdges = useCanvasStore((s) => s.toggleShowAllEdges)
  const gridDotVisibility = useSettingsStore((s) => s.env.gridDotVisibility)
  const cardBlur = useSettingsStore((s) => s.env.cardBlur)
  const setEnv = useSettingsStore((s) => s.setEnv)
  const [tileMenuOpen, setTileMenuOpen] = useState(false)
  const [envMenuOpen, setEnvMenuOpen] = useState(false)
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false)
  const tileMenuRef = useRef<HTMLDivElement>(null)
  const envMenuRef = useRef<HTMLDivElement>(null)
  const zoomMenuRef = useRef<HTMLDivElement>(null)

  const hasSelection = selectedNodeIds.size > 0
  const clearEnabled = hasNodes

  useEffect(() => {
    if (!tileMenuOpen && !envMenuOpen && !zoomMenuOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      if (tileMenuRef.current && !tileMenuRef.current.contains(event.target as Node)) {
        setTileMenuOpen(false)
      }
      if (envMenuRef.current && !envMenuRef.current.contains(event.target as Node)) {
        setEnvMenuOpen(false)
      }
      if (zoomMenuRef.current && !zoomMenuRef.current.contains(event.target as Node)) {
        setZoomMenuOpen(false)
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setTileMenuOpen(false)
        setEnvMenuOpen(false)
        setZoomMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [tileMenuOpen, envMenuOpen, zoomMenuOpen])

  const zoomIn = () => setViewport({ ...viewport, zoom: Math.min(3.0, viewport.zoom * 1.2) })
  const zoomOut = () => setViewport({ ...viewport, zoom: Math.max(0.1, viewport.zoom / 1.2) })
  const resetView = () => setViewport({ x: 0, y: 0, zoom: 1 })

  const zoomToActualSize = () => {
    const surface = getSurfaceSize()
    const cx = (-viewport.x + surface.width / 2) / viewport.zoom
    const cy = (-viewport.y + surface.height / 2) / viewport.zoom
    const nextZoom = 1
    setViewport({
      x: surface.width / 2 - cx * nextZoom,
      y: surface.height / 2 - cy * nextZoom,
      zoom: nextZoom
    })
  }

  const fitAll = () => {
    if (nodes.length === 0) return
    setViewport(fitViewportToNodes(nodes, getSurfaceSize()))
  }

  const fitSelection = () => {
    if (selectedNodeIds.size === 0) return
    const selected = nodes.filter((n) => selectedNodeIds.has(n.id))
    if (selected.length === 0) return
    setViewport(fitViewportToNodes(selected, getSurfaceSize()))
  }

  const zoomPercent = Math.round(viewport.zoom * 100)

  return (
    <div className="canvas-toolrail absolute top-3 left-3 z-30">
      {/* INPUT: get stuff onto the canvas */}
      <div className="canvas-toolbtn-wrap">
        <button
          onClick={onAddCard}
          className="canvas-toolbtn"
          data-testid="canvas-add-card"
          aria-label="Add card"
        >
          <ToolIcon icon={Plus} />
        </button>
        <Tip label="Add card" />
      </div>
      <div className="canvas-toolbtn-wrap">
        <button
          onClick={onOpenImport}
          className="canvas-toolbtn"
          data-testid="canvas-import"
          aria-label="Import notes"
        >
          <ToolIcon icon={Import} />
        </button>
        <Tip label="Import notes" shortcut="⌘G" />
      </div>
      <div className="canvas-toolrail__divider" />

      {/* VIEW: how am I seeing it */}
      <div className="canvas-toolbtn-wrap">
        <button onClick={zoomIn} className="canvas-toolbtn" aria-label="Zoom in">
          <ToolIcon icon={Plus} />
        </button>
        <Tip label="Zoom in" />
      </div>
      <div ref={zoomMenuRef} style={{ position: 'relative' }}>
        <div className="canvas-toolbtn-wrap">
          <button
            onClick={() => setZoomMenuOpen((prev) => !prev)}
            className="canvas-toolbtn canvas-zoom-badge"
            data-testid="canvas-zoom-menu"
            aria-label={`Zoom ${zoomPercent}%`}
            aria-haspopup="menu"
            aria-expanded={zoomMenuOpen}
          >
            {zoomPercent}%
          </button>
          <Tip label="Zoom" />
        </div>
        {zoomMenuOpen && (
          <div
            className="sidebar-popover absolute flex flex-col py-1"
            role="menu"
            style={{
              top: 0,
              left: '100%',
              marginLeft: 6,
              minWidth: 170,
              zIndex: zIndex.surfacePopover
            }}
          >
            <button
              type="button"
              role="menuitem"
              className="sidebar-popover-item"
              style={{ color: colors.text.primary }}
              onClick={() => {
                zoomToActualSize()
                setZoomMenuOpen(false)
              }}
            >
              Zoom to 100%
            </button>
            <button
              type="button"
              role="menuitem"
              className="sidebar-popover-item"
              style={{
                color: hasNodes ? colors.text.primary : colors.text.muted,
                cursor: hasNodes ? 'pointer' : 'not-allowed'
              }}
              disabled={!hasNodes}
              onClick={() => {
                fitAll()
                setZoomMenuOpen(false)
              }}
            >
              Fit all
            </button>
            <button
              type="button"
              role="menuitem"
              className="sidebar-popover-item"
              style={{
                color: hasSelection ? colors.text.primary : colors.text.muted,
                cursor: hasSelection ? 'pointer' : 'not-allowed'
              }}
              disabled={!hasSelection}
              onClick={() => {
                fitSelection()
                setZoomMenuOpen(false)
              }}
            >
              Zoom to selection
            </button>
            <div className="sidebar-popover-divider mx-3 my-1" />
            <button
              type="button"
              role="menuitem"
              className="sidebar-popover-item"
              style={{ color: colors.text.secondary }}
              onClick={() => {
                resetView()
                setZoomMenuOpen(false)
              }}
            >
              Reset view
            </button>
          </div>
        )}
      </div>
      <div className="canvas-toolbtn-wrap">
        <button onClick={zoomOut} className="canvas-toolbtn" aria-label="Zoom out">
          <ToolIcon icon={Minus} />
        </button>
        <Tip label="Zoom out" />
      </div>
      <div className="canvas-toolbtn-wrap">
        <button
          onClick={toggleShowAllEdges}
          className={`canvas-toolbtn${showAllEdges ? ' canvas-toolbtn--active' : ''}`}
          aria-label={showAllEdges ? 'Hide edges' : 'Show edges'}
          aria-pressed={showAllEdges}
        >
          <ToolIcon icon={Spline} />
        </button>
        <Tip label={showAllEdges ? 'Hide edges' : 'Show edges'} />
      </div>
      <div ref={envMenuRef} style={{ position: 'relative' }}>
        <div className="canvas-toolbtn-wrap">
          <button
            onClick={() => setEnvMenuOpen((prev) => !prev)}
            className="canvas-toolbtn"
            data-testid="canvas-env-settings"
            aria-label="Environment settings"
            aria-haspopup="menu"
            aria-expanded={envMenuOpen}
          >
            <ToolIcon icon={SlidersHorizontal} />
          </button>
          <Tip label="Environment" />
        </div>
        {envMenuOpen && (
          <div
            className="sidebar-popover absolute flex flex-col gap-3 p-3"
            style={{
              top: 0,
              left: '100%',
              marginLeft: 6,
              minWidth: 180,
              zIndex: zIndex.surfacePopover
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

      {/* HISTORY: take it back */}
      <div className="canvas-toolbtn-wrap">
        <button
          onClick={onUndo}
          className="canvas-toolbtn"
          disabled={!canUndo}
          data-testid="canvas-undo"
          aria-label="Undo"
        >
          <ToolIcon icon={Undo2} />
        </button>
        <Tip label="Undo" shortcut="⌘Z" />
      </div>
      <div className="canvas-toolbtn-wrap">
        <button
          onClick={onRedo}
          className="canvas-toolbtn"
          disabled={!canRedo}
          data-testid="canvas-redo"
          aria-label="Redo"
        >
          <ToolIcon icon={Redo2} />
        </button>
        <Tip label="Redo" shortcut="⇧⌘Z" />
      </div>

      <div className="canvas-toolrail__divider" />

      {/* ARRANGE: move things around */}
      <div ref={tileMenuRef} style={{ position: 'relative' }}>
        <div className="canvas-toolbtn-wrap">
          <button
            onClick={() => setTileMenuOpen((prev) => !prev)}
            className="canvas-toolbtn"
            data-testid="canvas-tile"
            aria-label="Tile layout"
            aria-haspopup="menu"
            aria-expanded={tileMenuOpen}
          >
            <ToolIcon icon={LayoutGrid} />
          </button>
          <Tip label="Tile layout" shortcut="⌘L" />
        </div>
        {tileMenuOpen && (
          <div
            className="sidebar-popover absolute flex flex-col py-1"
            style={{
              top: 0,
              left: '100%',
              marginLeft: 6,
              minWidth: 150,
              zIndex: zIndex.surfacePopover
            }}
          >
            <button
              className="sidebar-popover-item"
              style={{ color: colors.text.primary }}
              onClick={() => {
                const center = getViewportCenter()
                const { artifacts, graph, fileToId } = useVaultStore.getState()
                const fileToIdMap = new Map(Object.entries(fileToId))
                const artMap = new Map(artifacts.map((a) => [a.id, { id: a.id, tags: a.tags }]))
                useCanvasStore
                  .getState()
                  .applySemanticLayout(center, fileToIdMap, artMap, graph.edges)
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
                  useCanvasStore
                    .getState()
                    .applyTileLayout(p.id as TilePattern, getViewportCenter())
                  setTileMenuOpen(false)
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="canvas-toolbtn-wrap">
        <button
          onClick={onOrganize}
          disabled={organizePhase === 'processing'}
          className="canvas-toolbtn"
          data-testid="canvas-organize"
          aria-label={organizePhase === 'processing' ? 'Organizing…' : 'Organize'}
          style={{ cursor: organizePhase === 'processing' ? 'wait' : undefined }}
        >
          <ToolIcon icon={LayoutDashboard} />
        </button>
        <Tip label={organizePhase === 'processing' ? 'Organizing…' : 'Organize'} />
      </div>

      <div className="canvas-toolrail__divider" />

      {/* FRAMES: spatial bookmarks */}
      <div className="flex w-full flex-col items-center gap-1" style={{ padding: '2px 0' }}>
        {[1, 2, 3, 4, 5].map((slot) => {
          const slotKey = String(slot)
          const filled = slotKey in focusFrames
          return (
            <button
              key={slot}
              onClick={(e) => {
                const store = useCanvasStore.getState()
                if (e.altKey && filled) {
                  store.clearFocusFrame(slotKey)
                } else {
                  store.jumpToFocusFrame(slotKey)
                }
              }}
              title={
                filled
                  ? `Focus Frame ${slot} — ⌘${slot} jump, ⇧⌘${slot} overwrite, ⌥click clear`
                  : `Focus Frame ${slot} — ⇧⌘${slot} to save`
              }
              aria-label={filled ? `Jump to focus frame ${slot}` : `Focus frame ${slot} (empty)`}
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                border: `1.25px solid ${colors.text.muted}`,
                backgroundColor: filled ? colors.text.muted : 'transparent',
                cursor: 'pointer',
                padding: 0
              }}
            />
          )
        })}
      </div>

      <div className="canvas-toolrail__divider" />

      {/* DESTRUCTIVE: burn it down */}
      <div className="canvas-toolbtn-wrap">
        <button
          onClick={() => {
            if (clearEnabled) onClear()
          }}
          className="canvas-toolbtn"
          disabled={!clearEnabled}
          data-testid="canvas-clear"
          aria-label="Clear canvas"
          onMouseEnter={(e) => {
            if (clearEnabled) e.currentTarget.style.color = colors.claude.error
          }}
          onMouseLeave={(e) => {
            if (clearEnabled) e.currentTarget.style.color = ''
          }}
        >
          <ToolIcon icon={Trash2} />
        </button>
        <Tip label="Clear canvas" />
      </div>
    </div>
  )
}
