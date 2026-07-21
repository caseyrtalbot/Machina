import { useCallback, useRef } from 'react'
import type { CanvasStoreApi } from '../../store/canvas-store'
import { useCanvasApi, useCanvasId } from './canvas-store-context'
import { getMinSize, type CanvasNodeType } from '@shared/canvas-types'
import { perfMark, perfMeasure } from '../../utils/perf-marks'
import { getCommandStack, moveNodesCommand, resizeNodeCommand } from './canvas-commands'
import {
  ALIGN_SNAP_THRESHOLD_PX,
  AlignmentGuideOverlay,
  computeAlignmentSnap,
  type AlignmentBox,
  type AlignmentGuide
} from './canvas-alignment'

/** Module-level interaction debounce to prevent timer stacking */
let interactionTimer: ReturnType<typeof setTimeout> | null = null

function markInteracting(store: CanvasStoreApi, active: boolean) {
  if (interactionTimer) clearTimeout(interactionTimer)
  if (active) {
    store.getState().setInteracting(true)
  } else {
    interactionTimer = setTimeout(() => {
      store.getState().setInteracting(false)
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
  const canvas = useCanvasApi()
  const canvasId = useCanvasId()
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
      const { nodes, selectedNodeIds, viewport } = canvas.getState()
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
      markInteracting(canvas, true)

      // Alignment guides: snap the dragged card (the primary card in a group
      // drag) against every non-dragged card's edges/centers. Guides render
      // inside the transform layer so they pan/zoom with the content.
      const transformLayer =
        (e.currentTarget as HTMLElement).closest('[data-canvas-node]')?.parentElement ?? null
      const guideOverlay = transformLayer ? new AlignmentGuideOverlay(transformLayer, zoom) : null
      const draggedIds = isMultiDrag ? selectedNodeIds : new Set([nodeId])
      const neighborBoxes: readonly AlignmentBox[] = nodes
        .filter((n) => !draggedIds.has(n.id))
        .map((n) => ({
          x: n.position.x,
          y: n.position.y,
          width: n.size.width,
          height: n.size.height
        }))
      const movingSize = { width: node.size.width, height: node.size.height }
      const alignThreshold = ALIGN_SNAP_THRESHOLD_PX / zoom

      let latestSingleX = 0
      let latestSingleY = 0
      let latestMultiUpdates: Map<string, { x: number; y: number }> | null = null
      let latestGuides: readonly AlignmentGuide[] = []
      let rafPending = false

      const onMove = (me: PointerEvent) => {
        if (!dragStart.current) return
        const dx = (me.clientX - dragStart.current.x) / zoom
        const dy = (me.clientY - dragStart.current.y) / zoom

        const { moveNode, moveNodes } = canvas.getState()
        const positions = dragStart.current.groupPositions

        if (positions.size > 1) {
          let primaryX = dragStart.current.nx + dx
          let primaryY = dragStart.current.ny + dy

          if (me.shiftKey) {
            primaryX = snapToGrid(primaryX, SNAP_GRID_SIZE)
            primaryY = snapToGrid(primaryY, SNAP_GRID_SIZE)
            latestGuides = []
          } else {
            const snap = computeAlignmentSnap(
              { x: primaryX, y: primaryY, ...movingSize },
              neighborBoxes,
              alignThreshold
            )
            primaryX = snap.x
            primaryY = snap.y
            latestGuides = snap.guides
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
              guideOverlay?.update(latestGuides)
            })
          }
        } else {
          let newX = dragStart.current.nx + dx
          let newY = dragStart.current.ny + dy

          if (me.shiftKey) {
            newX = snapToGrid(newX, SNAP_GRID_SIZE)
            newY = snapToGrid(newY, SNAP_GRID_SIZE)
            latestGuides = []
          } else {
            const snap = computeAlignmentSnap(
              { x: newX, y: newY, ...movingSize },
              neighborBoxes,
              alignThreshold
            )
            newX = snap.x
            newY = snap.y
            latestGuides = snap.guides
          }

          latestSingleX = newX
          latestSingleY = newY

          if (!rafPending) {
            rafPending = true
            requestAnimationFrame(() => {
              rafPending = false
              moveNode(nodeId, { x: latestSingleX, y: latestSingleY })
              guideOverlay?.update(latestGuides)
            })
          }
        }
      }

      const onUp = () => {
        markInteracting(canvas, false)
        // Guides exist only while dragging. Zero latestGuides first so a
        // still-pending RAF update reconciles to nothing instead of
        // resurrecting lines after destroy.
        latestGuides = []
        guideOverlay?.destroy()
        // Flush final position if a RAF is still pending
        if (rafPending) {
          const { moveNode: mv, moveNodes: mvs } = canvas.getState()
          if (latestMultiUpdates) {
            mvs(latestMultiUpdates)
          } else {
            mv(nodeId, { x: latestSingleX, y: latestSingleY })
          }
        }
        const start = dragStart.current
        dragStart.current = null
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)

        // Push the completed move onto the command stack so ⌘Z undoes it.
        // Execute re-applies the end positions already in the store (no-op).
        const stack = getCommandStack(canvasId)
        if (start && stack) {
          const current = canvas.getState().nodes
          const before = new Map<string, { x: number; y: number }>()
          const after = new Map<string, { x: number; y: number }>()
          if (start.groupPositions.size > 1) {
            for (const [id, pos] of start.groupPositions) {
              const n = current.find((cn) => cn.id === id)
              if (!n) continue
              before.set(id, pos)
              after.set(id, { x: n.position.x, y: n.position.y })
            }
          } else {
            const n = current.find((cn) => cn.id === nodeId)
            if (n) {
              before.set(nodeId, { x: start.nx, y: start.ny })
              after.set(nodeId, { x: n.position.x, y: n.position.y })
            }
          }
          const moved = [...after].some(([id, pos]) => {
            const b = before.get(id)
            return !b || b.x !== pos.x || b.y !== pos.y
          })
          if (moved) stack.execute(moveNodesCommand(canvas, before, after))
        }
        perfMeasure('canvas-drag', 'drag-start')
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [nodeId, canvas, canvasId]
  )

  return { onDragStart }
}

export function useNodeResize(nodeId: string, nodeType: CanvasNodeType) {
  const canvas = useCanvasApi()
  const canvasId = useCanvasId()
  const resizeStart = useRef<{ x: number; y: number; w: number; h: number } | null>(null)

  const onResizeStart = useCallback(
    (e: React.PointerEvent) => {
      perfMark('resize-start')
      e.stopPropagation()
      const node = canvas.getState().nodes.find((n) => n.id === nodeId)
      if (!node) return

      const zoom = canvas.getState().viewport.zoom
      resizeStart.current = {
        x: e.clientX,
        y: e.clientY,
        w: node.size.width,
        h: node.size.height
      }
      markInteracting(canvas, true)

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
            canvas.getState().resizeNode(nodeId, {
              width: latestWidth,
              height: latestHeight
            })
          })
        }
      }

      const onUp = () => {
        markInteracting(canvas, false)
        // Flush final size if a RAF is still pending
        if (resizeRafPending) {
          canvas.getState().resizeNode(nodeId, {
            width: latestWidth,
            height: latestHeight
          })
        }
        const start = resizeStart.current
        resizeStart.current = null
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)

        // Push the completed resize onto the command stack so ⌘Z undoes it.
        const stack = getCommandStack(canvasId)
        if (start && stack) {
          const n = canvas.getState().nodes.find((cn) => cn.id === nodeId)
          if (n && (n.size.width !== start.w || n.size.height !== start.h)) {
            stack.execute(
              resizeNodeCommand(
                canvas,
                nodeId,
                { width: start.w, height: start.h },
                { width: n.size.width, height: n.size.height }
              )
            )
          }
        }
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
    [nodeId, nodeType, canvas, canvasId]
  )

  return { onResizeStart }
}
