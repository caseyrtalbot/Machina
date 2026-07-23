import { useEffect, useState } from 'react'
import {
  Import,
  LayoutDashboard,
  LayoutGrid,
  Minus,
  Plus,
  Redo2,
  Spline,
  Trash2,
  Undo2,
  type LucideIcon
} from 'lucide-react'
import { ContextMenu, type ContextMenuEntry } from '../../components/ContextMenu'
import { useCanvas, useCanvasApi, useCanvasId } from './canvas-store-context'
import type { CanvasStoreApi } from '../../store/canvas-store'
import { useVaultStore } from '../../store/vault-store'
import { TILE_PATTERNS, type TilePattern } from './canvas-tiling'
import { getCommandStack, layoutCommand } from './canvas-commands'
import { colors } from '../../design/tokens'

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
function getViewportCenter(store: CanvasStoreApi): { x: number; y: number } {
  const vp = store.getState().viewport
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
  const canvas = useCanvasApi()
  const canvasId = useCanvasId()
  const viewport = useCanvas((s) => s.viewport)
  const setViewport = useCanvas((s) => s.setViewport)
  const focusFrames = useCanvas((s) => s.focusFrames)
  const selectedNodeIds = useCanvas((s) => s.selectedNodeIds)
  const nodes = useCanvas((s) => s.nodes)
  const hasNodes = nodes.length > 0
  const showAllEdges = useCanvas((s) => s.showAllEdges)
  const toggleShowAllEdges = useCanvas((s) => s.toggleShowAllEdges)
  const [tileMenuAnchor, setTileMenuAnchor] = useState<DOMRect | null>(null)
  const [zoomMenuAnchor, setZoomMenuAnchor] = useState<DOMRect | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)

  const hasSelection = selectedNodeIds.size > 0
  const clearEnabled = hasNodes

  // Two-click clear: first click arms, second confirms; disarm after 3s.
  useEffect(() => {
    if (!confirmClear) return
    const timer = setTimeout(() => setConfirmClear(false), 3000)
    return () => clearTimeout(timer)
  }, [confirmClear])

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

  const runLayout = (buildLayout: () => void) => {
    const cmd = layoutCommand(canvas, buildLayout)
    if (cmd) {
      const stack = getCommandStack(canvasId)
      if (stack) stack.execute(cmd)
      else void cmd.execute()
    }
  }

  const zoomEntries: readonly ContextMenuEntry[] = [
    { id: 'zoom-100', label: 'Zoom to 100%', onSelect: zoomToActualSize },
    { id: 'fit-all', label: 'Fit all', disabled: !hasNodes, onSelect: fitAll },
    {
      id: 'zoom-selection',
      label: 'Zoom to selection',
      disabled: !hasSelection,
      onSelect: fitSelection
    },
    { kind: 'separator', id: 'sep-reset' },
    { id: 'reset-view', label: 'Reset view', onSelect: resetView }
  ]

  const tileEntries: readonly ContextMenuEntry[] = [
    {
      id: 'organize-topic',
      label: 'Organize by topic',
      onSelect: () => {
        const center = getViewportCenter(canvas)
        const { artifacts, graph, fileToId } = useVaultStore.getState()
        const fileToIdMap = new Map(Object.entries(fileToId))
        const artMap = new Map(artifacts.map((a) => [a.id, { id: a.id, tags: a.tags }]))
        runLayout(() =>
          canvas.getState().applySemanticLayout(center, fileToIdMap, artMap, graph.edges)
        )
      }
    },
    { kind: 'separator', id: 'sep-patterns' },
    ...TILE_PATTERNS.map(
      (p): ContextMenuEntry => ({
        id: p.id,
        label: p.label,
        onSelect: () =>
          runLayout(() =>
            canvas.getState().applyTileLayout(p.id as TilePattern, getViewportCenter(canvas))
          )
      })
    )
  ]

  return (
    <div className="canvas-toolrail te-float-chip absolute top-3 left-3 z-30">
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
      <div className="canvas-toolbtn-wrap">
        <button
          onClick={(e) => {
            // Read the rect before setState: currentTarget is nulled once the
            // handler returns, and the updater runs after that.
            const rect = e.currentTarget.getBoundingClientRect()
            setZoomMenuAnchor((prev) => (prev ? null : rect))
          }}
          className="canvas-toolbtn canvas-zoom-badge"
          data-testid="canvas-zoom-menu"
          aria-label={`Zoom ${zoomPercent}%`}
          aria-haspopup="menu"
          aria-expanded={zoomMenuAnchor !== null}
        >
          {zoomPercent}%
        </button>
        <Tip label="Zoom" />
      </div>
      {zoomMenuAnchor && (
        <ContextMenu
          position={{ x: zoomMenuAnchor.right + 6, y: zoomMenuAnchor.top }}
          items={zoomEntries}
          onClose={() => setZoomMenuAnchor(null)}
          minWidth={170}
        />
      )}
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
      <div className="canvas-toolbtn-wrap">
        <button
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            setTileMenuAnchor((prev) => (prev ? null : rect))
          }}
          className="canvas-toolbtn"
          data-testid="canvas-tile"
          aria-label="Tile layout"
          aria-haspopup="menu"
          aria-expanded={tileMenuAnchor !== null}
        >
          <ToolIcon icon={LayoutGrid} />
        </button>
        <Tip label="Tile layout" shortcut="⌘L" />
      </div>
      {tileMenuAnchor && (
        <ContextMenu
          position={{ x: tileMenuAnchor.right + 6, y: tileMenuAnchor.top }}
          items={tileEntries}
          onClose={() => setTileMenuAnchor(null)}
          minWidth={150}
        />
      )}
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
                const store = canvas.getState()
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

      {/* DESTRUCTIVE: burn it down (two-click confirm) */}
      <div className="canvas-toolbtn-wrap">
        <button
          onClick={() => {
            if (!clearEnabled) return
            if (confirmClear) {
              setConfirmClear(false)
              onClear()
            } else {
              setConfirmClear(true)
            }
          }}
          className="canvas-toolbtn"
          disabled={!clearEnabled}
          data-testid="canvas-clear"
          aria-label={confirmClear ? 'Confirm clear canvas' : 'Clear canvas'}
          style={confirmClear ? { color: colors.claude.error } : undefined}
          onMouseEnter={(e) => {
            if (clearEnabled) e.currentTarget.style.color = colors.claude.error
          }}
          onMouseLeave={(e) => {
            if (clearEnabled && !confirmClear) e.currentTarget.style.color = ''
          }}
        >
          <ToolIcon icon={Trash2} />
        </button>
        <Tip label={confirmClear ? 'Clear? Click again to confirm' : 'Clear canvas'} />
      </div>
    </div>
  )
}
