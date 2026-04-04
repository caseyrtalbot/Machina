import { useCallback, useRef } from 'react'
import { useCanvasStore } from '../../store/canvas-store'
import { getMinSize, type CanvasNodeType } from '@shared/canvas-types'
import { perfMark, perfMeasure } from '../../utils/perf-marks'

/** Module-level interaction debounce to prevent timer stacking */
let interactionTimer: ReturnType<typeof setTimeout> | null = null

function markInteracting(active: boolean) {
  if (interactionTimer) clearTimeout(interactionTimer)
  if (active) {
    useCanvasStore.getState().setInteracting(true)
  } else {
    interactionTimer = setTimeout(() => {
      useCanvasStore.getState().setInteracting(false)
    }, 150)
  }
}

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
      perfMark('drag-start')
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
      markInteracting(true)

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
        markInteracting(false)
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
        perfMeasure('canvas-drag', 'drag-start')
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
      perfMark('resize-start')
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
      markInteracting(true)

      const webviews = Array.from(document.querySelectorAll('webview')) as HTMLElement[]
      const previousPointerEvents = new Map<HTMLElement, string>()
      for (const webview of webviews) {
        previousPointerEvents.set(webview, webview.style.pointerEvents)
        webview.style.pointerEvents = 'none'
      }

      const min = getMinSize(nodeType)

      let latestWidth = resizeStart.current.w
      let latestHeight = resizeStart.current.h
      let resizeRafPending = false

      const onMove = (me: PointerEvent) => {
        if (!resizeStart.current) return
        const dx = (me.clientX - resizeStart.current.x) / zoom
        const dy = (me.clientY - resizeStart.current.y) / zoom
        latestWidth = Math.max(min.width, resizeStart.current.w + dx)
        latestHeight = Math.max(min.height, resizeStart.current.h + dy)

        if (!resizeRafPending) {
          resizeRafPending = true
          requestAnimationFrame(() => {
            resizeRafPending = false
            useCanvasStore.getState().resizeNode(nodeId, {
              width: latestWidth,
              height: latestHeight
            })
          })
        }
      }

      const onUp = () => {
        markInteracting(false)
        // Flush final size if a RAF is still pending
        if (resizeRafPending) {
          useCanvasStore.getState().resizeNode(nodeId, {
            width: latestWidth,
            height: latestHeight
          })
        }
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
        perfMeasure('canvas-resize', 'resize-start')
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [nodeId, nodeType]
  )

  return { onResizeStart }
}
