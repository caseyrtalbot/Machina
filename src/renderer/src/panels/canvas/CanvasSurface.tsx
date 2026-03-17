import { useRef, useCallback, useEffect, useState } from 'react'
import { useCanvasStore } from '../../store/canvas-store'
import { useCanvasViewport } from './use-canvas-viewport'
import { useCanvasSelection } from './use-canvas-selection'
import { colors } from '../../design/tokens'
import { TE_FILE_MIME, inferCardType } from './file-drop-utils'

const GRID_SIZE = 24
const MAJOR_EVERY = 4
const PATTERN_SIZE = GRID_SIZE * MAJOR_EVERY

function buildGridSvg(minorColor: string, majorColor: string): string {
  const dots: string[] = []
  for (let row = 0; row < MAJOR_EVERY; row++) {
    for (let col = 0; col < MAJOR_EVERY; col++) {
      const x = col * GRID_SIZE
      const y = row * GRID_SIZE
      const isMajor = row === 0 && col === 0
      if (isMajor) {
        dots.push(`<circle cx="${x}" cy="${y}" r="1.5" fill="${majorColor}"/>`)
      } else {
        dots.push(`<circle cx="${x}" cy="${y}" r="0.75" fill="${minorColor}"/>`)
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
  children: React.ReactNode
  onDoubleClick: (canvasX: number, canvasY: number, screenX: number, screenY: number) => void
  onBackgroundClick: () => void
  onFileDrop?: (canvasX: number, canvasY: number, dataJson: string) => void
}

export function CanvasSurface({
  children,
  onDoubleClick,
  onBackgroundClick,
  onFileDrop
}: CanvasSurfaceProps) {
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
      setDragOver(false)
      if (!onFileDrop) return

      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const canvasX = (e.clientX - rect.left - viewport.x) / viewport.zoom
      const canvasY = (e.clientY - rect.top - viewport.y) / viewport.zoom

      // Intra-app drag from sidebar
      const json = e.dataTransfer.getData(TE_FILE_MIME)
      if (json) {
        e.preventDefault()
        onFileDrop(canvasX, canvasY, json)
        return
      }

      // OS-level file drop (Finder, desktop, etc.)
      if (e.dataTransfer.files.length > 0) {
        e.preventDefault()
        const dragFiles = Array.from(e.dataTransfer.files).map((file) => ({
          path: (file as File & { path: string }).path,
          type: inferCardType((file as File & { path: string }).path)
        }))
        onFileDrop(canvasX, canvasY, JSON.stringify(dragFiles))
      }
    },
    [viewport, onFileDrop]
  )

  // Two-tier dot grid: minor dots every 24px, major dots every 4th interval (96px)
  const gridOpacity = Math.min(1, Math.max(0.1, viewport.zoom))

  const gridSvg = buildGridSvg('rgba(148, 163, 184, 0.25)', 'rgba(148, 163, 184, 0.5)')
  const svgDataUri = `url("data:image/svg+xml,${encodeURIComponent(gridSvg)}")`

  return (
    <div
      ref={containerRef}
      data-canvas-surface
      className="relative w-full h-full overflow-hidden"
      style={{
        backgroundColor: colors.bg.base,
        backgroundImage: svgDataUri,
        backgroundSize: `${PATTERN_SIZE * viewport.zoom}px ${PATTERN_SIZE * viewport.zoom}px`,
        backgroundPosition: `${viewport.x % (PATTERN_SIZE * viewport.zoom)}px ${viewport.y % (PATTERN_SIZE * viewport.zoom)}px`,
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
      {/* Dot grid opacity overlay */}
      <div className="absolute inset-0 pointer-events-none" style={{ opacity: gridOpacity }} />

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
