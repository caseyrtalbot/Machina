import { useRef, useCallback, useEffect } from 'react'
import { useCanvasStore } from '../../store/canvas-store'
import { useCanvasViewport } from './use-canvas-viewport'
import { colors } from '../../design/tokens'

interface CanvasSurfaceProps {
  children: React.ReactNode
  onDoubleClick: (canvasX: number, canvasY: number, screenX: number, screenY: number) => void
  onBackgroundClick: () => void
}

export function CanvasSurface({ children, onDoubleClick, onBackgroundClick }: CanvasSurfaceProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewport = useCanvasStore((s) => s.viewport)
  const { onWheel, onPointerDown } = useCanvasViewport(containerRef)

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
      // Click on background deselects
      if (
        !(e.target as HTMLElement).closest('[data-canvas-node]') &&
        !(e.target as HTMLElement).closest('[data-canvas-edge]')
      ) {
        onBackgroundClick()
      }
    },
    [onBackgroundClick]
  )

  // Dot grid: size scales with zoom, opacity fades at extreme zoom
  const dotSpacing = 24
  const dotRadius = 1
  const gridOpacity = Math.min(1, Math.max(0.1, viewport.zoom))

  return (
    <div
      ref={containerRef}
      data-canvas-surface
      className="relative w-full h-full overflow-hidden"
      style={{
        backgroundColor: colors.bg.base,
        backgroundImage: `radial-gradient(circle, ${colors.text.muted} ${dotRadius}px, transparent ${dotRadius}px)`,
        backgroundSize: `${dotSpacing * viewport.zoom}px ${dotSpacing * viewport.zoom}px`,
        backgroundPosition: `${viewport.x % (dotSpacing * viewport.zoom)}px ${viewport.y % (dotSpacing * viewport.zoom)}px`,
        cursor: 'default'
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={handleDoubleClick}
      onClick={handleClick}
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
    </div>
  )
}
