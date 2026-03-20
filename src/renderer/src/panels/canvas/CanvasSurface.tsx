import { useRef, useCallback, useEffect, useState } from 'react'
import { useCanvasStore } from '../../store/canvas-store'
import { useCanvasViewport } from './use-canvas-viewport'
import { useCanvasSelection } from './use-canvas-selection'
import { colors, canvasTokens } from '../../design/tokens'
import { TE_FILE_MIME, inferCardType } from './file-drop-utils'

const DOT_SPACING = 24
const CELLS_PER_SQUARE = 5
const PATTERN_SIZE = DOT_SPACING * CELLS_PER_SQUARE

function buildGridSvg(minorColor: string, majorColor: string): string {
  const dots: string[] = []
  for (let row = 0; row < CELLS_PER_SQUARE; row++) {
    for (let col = 0; col < CELLS_PER_SQUARE; col++) {
      const x = col * DOT_SPACING
      const y = row * DOT_SPACING
      const isCorner =
        (row === 0 || row === CELLS_PER_SQUARE - 1) && (col === 0 || col === CELLS_PER_SQUARE - 1)
      const color = isCorner ? majorColor : minorColor
      const r = isCorner ? 0.9 : 0.7
      dots.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`)
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

  // 5x5 square pattern: 25 dots per square, corner dots brighter
  const gridSvg = buildGridSvg('rgba(255, 255, 255, 0.12)', 'rgba(255, 255, 255, 0.22)')
  const svgDataUri = `url("data:image/svg+xml,${encodeURIComponent(gridSvg)}")`

  return (
    <div
      ref={containerRef}
      data-canvas-surface
      className="relative w-full h-full overflow-hidden"
      style={{
        backgroundColor: canvasTokens.surface,
        backgroundImage: `radial-gradient(ellipse at 40% 40%, rgba(255,255,255,0.03) 0%, transparent 70%), ${svgDataUri}`,
        backgroundSize: `100% 100%, ${PATTERN_SIZE * viewport.zoom}px ${PATTERN_SIZE * viewport.zoom}px`,
        backgroundPosition: `0 0, ${viewport.x % (PATTERN_SIZE * viewport.zoom)}px ${viewport.y % (PATTERN_SIZE * viewport.zoom)}px`,
        cursor: 'default'
      }}
      onPointerDown={(e) => {
        onPointerDown(e)
        onSelectionStart(e)
      }}
      onDoubleClick={handleDoubleClick}
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
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
