import { useMemo } from 'react'
import type { CanvasNode, CanvasViewport } from '@shared/canvas-types'

const BUFFER = 200

/**
 * Returns only nodes whose bounding boxes intersect the visible viewport
 * plus a buffer zone. Nodes fully outside the viewport are excluded from
 * rendering, which keeps the DOM small when the canvas has many cards.
 */
export function useViewportCulling(
  nodes: readonly CanvasNode[],
  viewport: CanvasViewport,
  containerSize: { width: number; height: number }
): readonly CanvasNode[] {
  return useMemo(() => {
    // Visible region in canvas coordinates
    const viewMinX = -viewport.x / viewport.zoom - BUFFER
    const viewMinY = -viewport.y / viewport.zoom - BUFFER
    const viewMaxX = (-viewport.x + containerSize.width) / viewport.zoom + BUFFER
    const viewMaxY = (-viewport.y + containerSize.height) / viewport.zoom + BUFFER

    return nodes.filter((node) => {
      const nx = node.position.x
      const ny = node.position.y
      const nw = node.size.width
      const nh = node.size.height

      // AABB intersection: node overlaps visible region
      return nx + nw > viewMinX && nx < viewMaxX && ny + nh > viewMinY && ny < viewMaxY
    })
  }, [nodes, viewport.x, viewport.y, viewport.zoom, containerSize.width, containerSize.height])
}
