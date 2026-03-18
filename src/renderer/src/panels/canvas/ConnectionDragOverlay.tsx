import { useState, useEffect } from 'react'
import { useCanvasStore } from '../../store/canvas-store'
import {
  createCanvasEdge,
  createCanvasNode,
  type CanvasSide,
  type CanvasNode
} from '@shared/canvas-types'
import { colors } from '../../design/tokens'

interface DragState {
  fromNodeId: string
  fromSide: CanvasSide
  cursorX: number
  cursorY: number
}

// Ref-based event bus avoids stale closures in callbacks
const dragRef: { current: DragState | null } = { current: null }
let setDragFn: ((state: DragState | null) => void) | null = null
let addEdgeFn: ((edge: ReturnType<typeof createCanvasEdge>) => void) | null = null

// eslint-disable-next-line react-refresh/only-export-components
export function isConnectionDragActive(): boolean {
  return dragRef.current !== null
}

// eslint-disable-next-line react-refresh/only-export-components
export function startConnectionDrag(
  fromNodeId: string,
  fromSide: CanvasSide,
  clientX: number,
  clientY: number
): void {
  const state = { fromNodeId, fromSide, cursorX: clientX, cursorY: clientY }
  dragRef.current = state
  setDragFn?.(state)
}

// eslint-disable-next-line react-refresh/only-export-components
export function endConnectionDrag(toNodeId: string, toSide: CanvasSide): void {
  const drag = dragRef.current
  if (!drag) return
  if (drag.fromNodeId !== toNodeId) {
    addEdgeFn?.(createCanvasEdge(drag.fromNodeId, toNodeId, drag.fromSide, toSide))
  }
  dragRef.current = null
  setDragFn?.(null)
}

function getAnchorPoint(node: CanvasNode, side: CanvasSide): { x: number; y: number } {
  const { x, y } = node.position
  const { width, height } = node.size
  switch (side) {
    case 'top':
      return { x: x + width / 2, y }
    case 'bottom':
      return { x: x + width / 2, y: y + height }
    case 'left':
      return { x, y: y + height / 2 }
    case 'right':
      return { x: x + width, y: y + height / 2 }
  }
}

function DragPreviewLine({ drag }: { drag: DragState }) {
  const viewport = useCanvasStore((s) => s.viewport)
  const nodes = useCanvasStore((s) => s.nodes)

  const sourceNode = nodes.find((n) => n.id === drag.fromNodeId)
  if (!sourceNode) return null

  const anchor = getAnchorPoint(sourceNode, drag.fromSide)

  // Convert anchor from canvas coords to screen coords
  const surface = document.querySelector('[data-canvas-surface]')
  if (!surface) return null
  const surfaceRect = surface.getBoundingClientRect()
  const ax = surfaceRect.left + viewport.x + anchor.x * viewport.zoom
  const ay = surfaceRect.top + viewport.y + anchor.y * viewport.zoom

  const cx = drag.cursorX
  const cy = drag.cursorY

  // Control points: extend from source in the direction of its side
  const dist = Math.sqrt((cx - ax) ** 2 + (cy - ay) ** 2)
  const offset = Math.min(dist * 0.4, 100)

  let cp1x = ax
  let cp1y = ay
  switch (drag.fromSide) {
    case 'top':
      cp1y -= offset
      break
    case 'bottom':
      cp1y += offset
      break
    case 'left':
      cp1x -= offset
      break
    case 'right':
      cp1x += offset
      break
  }

  // Second control point pulls from cursor back toward source
  const angle = Math.atan2(ay - cy, ax - cx)
  const cp2x = cx + Math.cos(angle) * offset
  const cp2y = cy + Math.sin(angle) * offset

  const d = `M ${ax} ${ay} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${cx} ${cy}`

  return (
    <svg className="fixed inset-0 w-full h-full pointer-events-none" style={{ zIndex: 39 }}>
      <path
        d={d}
        fill="none"
        stroke={colors.accent.default}
        strokeWidth={2}
        strokeDasharray="6 3"
        opacity={0.8}
      />
      <circle cx={cx} cy={cy} r={4} fill={colors.accent.default} opacity={0.6} />
    </svg>
  )
}

export function ConnectionDragOverlay() {
  const [drag, setDrag] = useState<DragState | null>(null)
  const addEdge = useCanvasStore((s) => s.addEdge)

  // Keep the module-level refs in sync
  // eslint-disable-next-line react-hooks/globals -- module-level event bus pattern for cross-component drag
  setDragFn = setDrag
  // eslint-disable-next-line react-hooks/globals
  addEdgeFn = addEdge

  useEffect(() => {
    if (!drag) return

    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return
      const next = { ...dragRef.current, cursorX: e.clientX, cursorY: e.clientY }
      dragRef.current = next
      setDrag(next)
    }
    const onUp = (e: PointerEvent) => {
      const drag = dragRef.current
      if (drag) {
        // No card caught the drop — create a new text card at cursor position
        const surface = document.querySelector('[data-canvas-surface]')
        if (surface) {
          const surfaceRect = surface.getBoundingClientRect()
          const { viewport, addNode, addEdge } = useCanvasStore.getState()

          // Screen coords → canvas coords
          const canvasX = (e.clientX - surfaceRect.left - viewport.x) / viewport.zoom
          const canvasY = (e.clientY - surfaceRect.top - viewport.y) / viewport.zoom

          const newNode = createCanvasNode('text', {
            x: canvasX - 130,
            y: canvasY - 70
          })
          addNode(newNode)

          // Connect from source side to opposite side on new card
          const oppositeSide: Record<CanvasSide, CanvasSide> = {
            top: 'bottom',
            bottom: 'top',
            left: 'right',
            right: 'left'
          }
          addEdge(
            createCanvasEdge(
              drag.fromNodeId,
              newNode.id,
              drag.fromSide,
              oppositeSide[drag.fromSide]
            )
          )
        }
      }
      dragRef.current = null
      setDrag(null)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [drag !== null]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!drag) return null

  return (
    <>
      <DragPreviewLine drag={drag} />
      <div className="fixed inset-0 pointer-events-none z-40">
        <div
          className="text-xs px-2 py-1 rounded"
          style={{
            position: 'fixed',
            left: drag.cursorX + 10,
            top: drag.cursorY + 10,
            backgroundColor: colors.bg.elevated,
            color: colors.accent.default,
            border: `1px solid ${colors.accent.default}`
          }}
        >
          Drop on a card to connect
        </div>
      </div>
    </>
  )
}
