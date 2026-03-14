import { useState, useEffect, useRef } from 'react'
import { useCanvasStore } from '../../store/canvas-store'
import { createCanvasEdge, type CanvasSide } from '@shared/canvas-types'
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

export function startConnectionDrag(fromNodeId: string, fromSide: CanvasSide): void {
  const state = { fromNodeId, fromSide, cursorX: 0, cursorY: 0 }
  dragRef.current = state
  setDragFn?.(state)
}

export function endConnectionDrag(toNodeId: string, toSide: CanvasSide): void {
  const drag = dragRef.current
  if (!drag) return
  if (drag.fromNodeId !== toNodeId) {
    addEdgeFn?.(createCanvasEdge(drag.fromNodeId, toNodeId, drag.fromSide, toSide))
  }
  dragRef.current = null
  setDragFn?.(null)
}

export function ConnectionDragOverlay() {
  const [drag, setDrag] = useState<DragState | null>(null)
  const addEdge = useCanvasStore((s) => s.addEdge)

  // Keep the module-level refs in sync
  setDragFn = setDrag
  addEdgeFn = addEdge

  useEffect(() => {
    if (!drag) return

    const onMove = (e: PointerEvent) => {
      const next = { ...dragRef.current!, cursorX: e.clientX, cursorY: e.clientY }
      dragRef.current = next
      setDrag(next)
    }
    const onUp = () => {
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
  )
}
