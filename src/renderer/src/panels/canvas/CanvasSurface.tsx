import { useRef, useCallback, useEffect, useMemo, useState } from 'react'
import { useCanvasStore } from '../../store/canvas-store'
import { useCanvasViewport } from './use-canvas-viewport'
import { useCanvasSelection } from './use-canvas-selection'
import { colors, canvasTokens } from '../../design/tokens'
import { TE_FILE_MIME, inferCardType } from './file-drop-utils'

const DOT_SPACING = 24
const CELLS_PER_SQUARE = 5
const PATTERN_SIZE = DOT_SPACING * CELLS_PER_SQUARE

interface GridParams {
  readonly minorOpacity: number
  readonly majorOpacity: number
  readonly minorRadius: number
  readonly majorRadius: number
}

/** Zoom breakpoints for grid visual zones */
const GRID_ZONES: readonly { zoom: number; params: GridParams }[] = [
  { zoom: 0.1, params: { minorOpacity: 0, majorOpacity: 0.1, minorRadius: 0, majorRadius: 0.5 } },
  {
    zoom: 0.15,
    params: { minorOpacity: 0, majorOpacity: 0.1, minorRadius: 0, majorRadius: 0.5 }
  },
  {
    zoom: 0.4,
    params: { minorOpacity: 0.05, majorOpacity: 0.16, minorRadius: 0.6, majorRadius: 0.85 }
  },
  {
    zoom: 1.5,
    params: { minorOpacity: 0.12, majorOpacity: 0.22, minorRadius: 0.7, majorRadius: 0.9 }
  },
  {
    zoom: 3.0,
    params: { minorOpacity: 0.18, majorOpacity: 0.28, minorRadius: 0.8, majorRadius: 1.1 }
  }
]

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Compute grid dot params with smooth interpolation across zoom zones */
function computeGridParams(zoom: number): GridParams {
  if (zoom <= GRID_ZONES[0].zoom) return GRID_ZONES[0].params
  const last = GRID_ZONES[GRID_ZONES.length - 1]
  if (zoom >= last.zoom) return last.params

  for (let i = 0; i < GRID_ZONES.length - 1; i++) {
    const lo = GRID_ZONES[i]
    const hi = GRID_ZONES[i + 1]
    if (zoom >= lo.zoom && zoom <= hi.zoom) {
      const t = (zoom - lo.zoom) / (hi.zoom - lo.zoom)
      return {
        minorOpacity: lerp(lo.params.minorOpacity, hi.params.minorOpacity, t),
        majorOpacity: lerp(lo.params.majorOpacity, hi.params.majorOpacity, t),
        minorRadius: lerp(lo.params.minorRadius, hi.params.minorRadius, t),
        majorRadius: lerp(lo.params.majorRadius, hi.params.majorRadius, t)
      }
    }
  }
  return last.params
}

function buildGridSvg(params: GridParams): string {
  const dots: string[] = []
  for (let row = 0; row < CELLS_PER_SQUARE; row++) {
    for (let col = 0; col < CELLS_PER_SQUARE; col++) {
      const x = col * DOT_SPACING
      const y = row * DOT_SPACING
      const isCorner =
        (row === 0 || row === CELLS_PER_SQUARE - 1) && (col === 0 || col === CELLS_PER_SQUARE - 1)
      const opacity = isCorner ? params.majorOpacity : params.minorOpacity
      const r = isCorner ? params.majorRadius : params.minorRadius
      if (opacity > 0 && r > 0) {
        dots.push(
          `<circle cx="${x}" cy="${y}" r="${r}" fill="rgba(255,255,255,${opacity.toFixed(3)})"/>`
        )
      }
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg"` +
    ` width="${PATTERN_SIZE}" height="${PATTERN_SIZE}">` +
    dots.join('') +
    `</svg>`
  )
}

interface CanvasSurfaceProps {
  readonly children: React.ReactNode
  readonly onDoubleClick: (
    canvasX: number,
    canvasY: number,
    screenX: number,
    screenY: number
  ) => void
  readonly onBackgroundClick: () => void
  readonly onFileDrop?: (canvasX: number, canvasY: number, dataJson: string) => void
}

export function CanvasSurface({
  children,
  onDoubleClick,
  onBackgroundClick,
  onFileDrop
}: CanvasSurfaceProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewport = useCanvasStore((s) => s.viewport)
  const { onWheel, onPointerDown } = useCanvasViewport(containerRef)
  const { rect, onSelectionStart, wasSelectionDrag } = useCanvasSelection()

  // Attach wheel listener with { passive: false } to allow preventDefault
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handler = (e: WheelEvent) => onWheel(e)
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [onWheel])

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      // Only trigger on background clicks (not on cards)
      if ((e.target as HTMLElement).closest('[data-canvas-node]')) return
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return

      // Convert screen coords to canvas coords
      const canvasX = (e.clientX - rect.left - viewport.x) / viewport.zoom
      const canvasY = (e.clientY - rect.top - viewport.y) / viewport.zoom
      onDoubleClick(canvasX, canvasY, e.clientX, e.clientY)
    },
    [viewport, onDoubleClick]
  )

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // Don't clear selection if the user just finished a drag-to-select
      if (wasSelectionDrag()) return

      // Click on background deselects
      if (
        !(e.target as HTMLElement).closest('[data-canvas-node]') &&
        !(e.target as HTMLElement).closest('[data-canvas-edge]')
      ) {
        onBackgroundClick()
      }
    },
    [onBackgroundClick, wasSelectionDrag]
  )

  // Drag-over state for file drops from sidebar
  const [dragOver, setDragOver] = useState(false)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    const hasTeMime = e.dataTransfer.types.includes(TE_FILE_MIME)
    const hasFiles = e.dataTransfer.types.includes('Files')
    if (!hasTeMime && !hasFiles) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only reset when leaving the surface itself (not when entering a child)
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragOver(false)
      if (!onFileDrop) return

      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const canvasX = (e.clientX - rect.left - viewport.x) / viewport.zoom
      const canvasY = (e.clientY - rect.top - viewport.y) / viewport.zoom

      // Intra-app drag from sidebar
      const json = e.dataTransfer.getData(TE_FILE_MIME)
      if (json) {
        onFileDrop(canvasX, canvasY, json)
        return
      }

      // OS-level file drop (Finder, desktop, etc.)
      if (e.dataTransfer.files.length > 0) {
        const dragFiles = Array.from(e.dataTransfer.files).map((file) => {
          const filePath = window.api.getFilePath(file)
          return { path: filePath, type: inferCardType(filePath) }
        })
        onFileDrop(canvasX, canvasY, JSON.stringify(dragFiles))
      }
    },
    [viewport, onFileDrop]
  )

  // Grid dots scale smoothly with zoom: faint when zoomed out, prominent when zoomed in
  const svgDataUri = useMemo(() => {
    const params = computeGridParams(viewport.zoom)
    const svg = buildGridSvg(params)
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
  }, [viewport.zoom])

  // Spotlight: brighter dot layer revealed by a radial mask that follows the mouse
  const spotlightRef = useRef<HTMLDivElement>(null)
  const spotlightSvg = useMemo(() => {
    const params = computeGridParams(viewport.zoom)
    const bright: GridParams = {
      minorOpacity: Math.min(params.minorOpacity * 3 + 0.08, 0.5),
      majorOpacity: Math.min(params.majorOpacity * 2.5 + 0.1, 0.7),
      minorRadius: params.minorRadius * 1.4,
      majorRadius: params.majorRadius * 1.4
    }
    const svg = buildGridSvg(bright)
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
  }, [viewport.zoom])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const el = spotlightRef.current
    if (!el) return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const grad = `radial-gradient(circle 160px at ${x}px ${y}px, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.25) 40%, transparent 70%)`
    el.style.maskImage = grad
    el.style.webkitMaskImage = grad
    el.style.opacity = '1'
  }, [])

  const handleMouseLeave = useCallback(() => {
    const el = spotlightRef.current
    if (el) el.style.opacity = '0'
  }, [])

  const tileSize = PATTERN_SIZE * viewport.zoom
  const bgPos = `${viewport.x % tileSize}px ${viewport.y % tileSize}px`

  return (
    <div
      ref={containerRef}
      data-canvas-surface
      className="relative w-full h-full overflow-hidden"
      style={{
        backgroundColor: canvasTokens.surface,
        backgroundImage: `radial-gradient(ellipse at 40% 40%, rgba(255,255,255,0.03) 0%, transparent 70%), ${svgDataUri}`,
        backgroundSize: `100% 100%, ${tileSize}px ${tileSize}px`,
        backgroundPosition: `0 0, ${bgPos}`,
        cursor: 'default'
      }}
      onPointerDown={(e) => {
        onPointerDown(e)
        onSelectionStart(e)
      }}
      onDoubleClick={handleDoubleClick}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Spotlight overlay: brighter dots revealed by radial mask around cursor */}
      <div
        ref={spotlightRef}
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: spotlightSvg,
          backgroundSize: `${tileSize}px ${tileSize}px`,
          backgroundPosition: bgPos,
          opacity: 0,
          transition: 'opacity 300ms ease-out'
        }}
      />

      {/* Viewport transform layer */}
      <div
        className="absolute origin-top-left"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
          willChange: 'transform'
        }}
      >
        {children}
      </div>

      {rect && (
        <div
          className="fixed border pointer-events-none"
          style={{
            left: Math.min(rect.startX, rect.endX),
            top: Math.min(rect.startY, rect.endY),
            width: Math.abs(rect.endX - rect.startX),
            height: Math.abs(rect.endY - rect.startY),
            borderColor: colors.accent.default,
            backgroundColor: colors.accent.muted
          }}
        />
      )}

      {/* Drag-over overlay */}
      {dragOver && (
        <div
          className="absolute inset-2 rounded-lg pointer-events-none"
          style={{
            border: `2px dashed ${colors.accent.default}`,
            backgroundColor: 'rgba(99, 102, 241, 0.05)'
          }}
        />
      )}
    </div>
  )
}
