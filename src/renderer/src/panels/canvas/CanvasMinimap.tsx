import { useCallback, useRef } from 'react'
import { useCanvas, useCanvasApi } from './canvas-store-context'
import type { CanvasStoreApi } from '../../store/canvas-store'
import type { CanvasNode, CanvasViewport } from '@shared/canvas-types'
import { getCardTypeColor } from './canvas-colors'

let minimapInteractionTimer: ReturnType<typeof setTimeout> | null = null

function markMinimapInteracting(store: CanvasStoreApi, active: boolean) {
  if (minimapInteractionTimer) clearTimeout(minimapInteractionTimer)
  if (active) {
    store.getState().setInteracting(true)
  } else {
    minimapInteractionTimer = setTimeout(() => {
      store.getState().setInteracting(false)
    }, 150)
  }
}

const MINIMAP_WIDTH = 160
const MINIMAP_HEIGHT = 120
const PADDING = 8

interface Bounds {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

function computeCanvasBounds(nodes: readonly CanvasNode[]): Bounds {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 1000, maxY: 1000 }
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const node of nodes) {
    minX = Math.min(minX, node.position.x)
    minY = Math.min(minY, node.position.y)
    maxX = Math.max(maxX, node.position.x + node.size.width)
    maxY = Math.max(maxY, node.position.y + node.size.height)
  }

  // Add padding around the bounds
  const pad = 200
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad }
}

function computeViewportRect(
  viewport: CanvasViewport,
  containerWidth: number,
  containerHeight: number
): { x: number; y: number; width: number; height: number } {
  // The viewport transform is: translate(vp.x, vp.y) scale(vp.zoom)
  // So the visible canvas region is:
  //   left = -vp.x / vp.zoom
  //   top = -vp.y / vp.zoom
  //   width = containerWidth / vp.zoom
  //   height = containerHeight / vp.zoom
  return {
    x: -viewport.x / viewport.zoom,
    y: -viewport.y / viewport.zoom,
    width: containerWidth / viewport.zoom,
    height: containerHeight / viewport.zoom
  }
}

export function CanvasMinimap({
  containerWidth,
  containerHeight
}: {
  readonly containerWidth: number
  readonly containerHeight: number
}) {
  const canvas = useCanvasApi()
  const nodes = useCanvas((s) => s.nodes)
  const viewport = useCanvas((s) => s.viewport)
  const setViewport = useCanvas((s) => s.setViewport)
  const minimapRef = useRef<HTMLDivElement>(null)

  const bounds = computeCanvasBounds(nodes)
  const vpRect = computeViewportRect(viewport, containerWidth, containerHeight)

  // Include viewport in bounds calculation so the indicator is always visible
  const totalBounds: Bounds = {
    minX: Math.min(bounds.minX, vpRect.x),
    minY: Math.min(bounds.minY, vpRect.y),
    maxX: Math.max(bounds.maxX, vpRect.x + vpRect.width),
    maxY: Math.max(bounds.maxY, vpRect.y + vpRect.height)
  }

  const canvasW = totalBounds.maxX - totalBounds.minX
  const canvasH = totalBounds.maxY - totalBounds.minY

  // Scale factor to fit canvas into minimap
  const innerW = MINIMAP_WIDTH - PADDING * 2
  const innerH = MINIMAP_HEIGHT - PADDING * 2
  const scale = Math.min(innerW / canvasW, innerH / canvasH)

  const toMiniX = (cx: number) => PADDING + (cx - totalBounds.minX) * scale
  const toMiniY = (cy: number) => PADDING + (cy - totalBounds.minY) * scale

  const panToCanvasPoint = useCallback(
    (canvasX: number, canvasY: number) => {
      // Center the viewport on the given canvas point
      setViewport({
        x: -(canvasX - containerWidth / viewport.zoom / 2) * viewport.zoom,
        y: -(canvasY - containerHeight / viewport.zoom / 2) * viewport.zoom,
        zoom: viewport.zoom
      })
    },
    [viewport.zoom, containerWidth, containerHeight, setViewport]
  )

  const handleMinimapClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      const rect = minimapRef.current?.getBoundingClientRect()
      if (!rect) return

      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top

      // Convert minimap coords to canvas coords
      const canvasX = totalBounds.minX + (mx - PADDING) / scale
      const canvasY = totalBounds.minY + (my - PADDING) / scale

      panToCanvasPoint(canvasX, canvasY)
    },
    [totalBounds.minX, totalBounds.minY, scale, panToCanvasPoint]
  )

  const handleViewportDrag = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation()
      e.preventDefault()
      markMinimapInteracting(canvas, true)

      const rect = minimapRef.current?.getBoundingClientRect()
      if (!rect) return

      const onMove = (me: PointerEvent) => {
        const mx = me.clientX - rect.left
        const my = me.clientY - rect.top

        const canvasX = totalBounds.minX + (mx - PADDING) / scale
        const canvasY = totalBounds.minY + (my - PADDING) / scale

        panToCanvasPoint(canvasX, canvasY)
      }

      const onUp = () => {
        markMinimapInteracting(canvas, false)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [totalBounds.minX, totalBounds.minY, scale, panToCanvasPoint, canvas]
  )

  return (
    <div
      ref={minimapRef}
      data-testid="canvas-minimap"
      className="canvas-minimap absolute pointer-events-auto"
      style={{
        bottom: 40,
        right: 12,
        width: MINIMAP_WIDTH,
        height: MINIMAP_HEIGHT,
        zIndex: 20,
        cursor: 'crosshair'
      }}
      onClick={handleMinimapClick}
    >
      <div className="canvas-minimap__label">Map</div>
      {/* Card rectangles */}
      {nodes.map((node) => (
        <div
          key={node.id}
          className="absolute"
          style={{
            left: toMiniX(node.position.x),
            top: toMiniY(node.position.y),
            width: Math.max(2, node.size.width * scale),
            height: Math.max(2, node.size.height * scale),
            backgroundColor: getCardTypeColor(node.type),
            opacity: 0.6,
            borderRadius: 0,
            pointerEvents: 'none'
          }}
        />
      ))}

      {/* Viewport indicator */}
      <div
        className="absolute"
        style={{
          left: toMiniX(vpRect.x),
          top: toMiniY(vpRect.y),
          width: Math.max(4, vpRect.width * scale),
          height: Math.max(4, vpRect.height * scale),
          border: '1px solid color-mix(in srgb, var(--color-accent-default) 70%, transparent)',
          backgroundColor: 'color-mix(in srgb, var(--color-accent-default) 12%, transparent)',
          borderRadius: 0,
          cursor: 'grab',
          pointerEvents: 'auto'
        }}
        onPointerDown={handleViewportDrag}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}
