import { useCallback, useRef } from 'react'
import { useCanvasStore } from '../../store/canvas-store'
import { getMinSize, type CanvasNodeType } from '@shared/canvas-types'

/** Grid size for Shift-snap (matches dot grid spacing in CanvasSurface) */
export const SNAP_GRID_SIZE = 24

/** Snap a value to the nearest grid multiple */
export function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize || 0
}

export function useNodeDrag(nodeId: string) {
  const dragStart = useRef<{
    x: number
    y: number
    nx: number
    ny: number
    groupPositions: ReadonlyMap<string, { x: number; y: number }>
  } | null>(null)

  const onDragStart = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation()
      const { nodes, selectedNodeIds, viewport } = useCanvasStore.getState()
      const node = nodes.find((n) => n.id === nodeId)
      if (!node) return

      const zoom = viewport.zoom
      const isMultiDrag = selectedNodeIds.has(nodeId) && selectedNodeIds.size > 1

      // Capture initial positions of all selected nodes for group drag
      const groupPositions = new Map<string, { x: number; y: number }>()
      if (isMultiDrag) {
        for (const n of nodes) {
          if (selectedNodeIds.has(n.id)) {
            groupPositions.set(n.id, { x: n.position.x, y: n.position.y })
          }
        }
      }

      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        nx: node.position.x,
        ny: node.position.y,
        groupPositions
      }

      let latestSingleX = 0
      let latestSingleY = 0
      let latestMultiUpdates: Map<string, { x: number; y: number }> | null = null
      let rafPending = false

      const onMove = (me: PointerEvent) => {
        if (!dragStart.current) return
        const dx = (me.clientX - dragStart.current.x) / zoom
        const dy = (me.clientY - dragStart.current.y) / zoom

        const { moveNode, moveNodes } = useCanvasStore.getState()
        const positions = dragStart.current.groupPositions

        if (positions.size > 1) {
          let primaryX = dragStart.current.nx + dx
          let primaryY = dragStart.current.ny + dy

          if (me.shiftKey) {
            primaryX = snapToGrid(primaryX, SNAP_GRID_SIZE)
            primaryY = snapToGrid(primaryY, SNAP_GRID_SIZE)
          }

          const deltaX = primaryX - dragStart.current.nx
          const deltaY = primaryY - dragStart.current.ny

          const updates = new Map<string, { x: number; y: number }>()
          for (const [id, startPos] of positions) {
            updates.set(id, { x: startPos.x + deltaX, y: startPos.y + deltaY })
          }
          latestMultiUpdates = updates

          if (!rafPending) {
            rafPending = true
            requestAnimationFrame(() => {
              rafPending = false
              if (latestMultiUpdates) {
                moveNodes(latestMultiUpdates)
              }
            })
          }
        } else {
          let newX = dragStart.current.nx + dx
          let newY = dragStart.current.ny + dy

          if (me.shiftKey) {
            newX = snapToGrid(newX, SNAP_GRID_SIZE)
            newY = snapToGrid(newY, SNAP_GRID_SIZE)
          }

          latestSingleX = newX
          latestSingleY = newY

          if (!rafPending) {
            rafPending = true
            requestAnimationFrame(() => {
              rafPending = false
              moveNode(nodeId, { x: latestSingleX, y: latestSingleY })
            })
          }
        }
      }

      const onUp = () => {
        // Flush final position if a RAF is still pending
        if (rafPending) {
          const { moveNode: mv, moveNodes: mvs } = useCanvasStore.getState()
          if (latestMultiUpdates) {
            mvs(latestMultiUpdates)
          } else {
            mv(nodeId, { x: latestSingleX, y: latestSingleY })
          }
        }
        dragStart.current = null
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [nodeId]
  )

  return { onDragStart }
}

export function useNodeResize(nodeId: string, nodeType: CanvasNodeType) {
  const resizeStart = useRef<{ x: number; y: number; w: number; h: number } | null>(null)

  const onResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation()
      const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId)
      if (!node) return

      const zoom = useCanvasStore.getState().viewport.zoom
      resizeStart.current = {
        x: e.clientX,
        y: e.clientY,
        w: node.size.width,
        h: node.size.height
      }

      const webviews = Array.from(document.querySelectorAll('webview')) as HTMLElement[]
      const previousPointerEvents = new Map<HTMLElement, string>()
      for (const webview of webviews) {
        previousPointerEvents.set(webview, webview.style.pointerEvents)
        webview.style.pointerEvents = 'none'
      }

      const min = getMinSize(nodeType)

      const onMove = (me: PointerEvent) => {
        if (!resizeStart.current) return
        const dx = (me.clientX - resizeStart.current.x) / zoom
        const dy = (me.clientY - resizeStart.current.y) / zoom
        useCanvasStore.getState().resizeNode(nodeId, {
          width: Math.max(min.width, resizeStart.current.w + dx),
          height: Math.max(min.height, resizeStart.current.h + dy)
        })
      }

      const onUp = () => {
        resizeStart.current = null
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        for (const webview of webviews) {
          webview.style.pointerEvents = previousPointerEvents.get(webview) ?? ''
        }
        window.dispatchEvent(
          new CustomEvent('canvas:node-resize-end', {
            detail: { nodeId }
          })
        )
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [nodeId, nodeType]
  )

  return { onResizeStart }
}
