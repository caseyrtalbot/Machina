import { useState, useCallback, useEffect } from 'react'
import { useCanvasStore } from '../../store/canvas-store'
import { createCanvasEdge, type CanvasSide } from '@shared/canvas-types'
import { colors } from '../../design/tokens'

interface DragState {
  fromNodeId: string
  fromSide: CanvasSide
  cursorX: number
  cursorY: number
}

// Export a singleton event bus for anchor dots to trigger
let onDragStartCallback: ((fromNodeId: string, fromSide: CanvasSide) => void) | null = null
let onDragEndCallback: ((toNodeId: string, toSide: CanvasSide) => void) | null = null

export function startConnectionDrag(fromNodeId: string, fromSide: CanvasSide): void {
  onDragStartCallback?.(fromNodeId, fromSide)
}

export function endConnectionDrag(toNodeId: string, toSide: CanvasSide): void {
  onDragEndCallback?.(toNodeId, toSide)
}

export function ConnectionDragOverlay() {
  const [drag, setDrag] = useState<DragState | null>(null)
  const addEdge = useCanvasStore((s) => s.addEdge)

  onDragStartCallback = useCallback(
    (fromNodeId: string, fromSide: CanvasSide) => {
      setDrag({ fromNodeId, fromSide, cursorX: 0, cursorY: 0 })
    },
    []
  )

  onDragEndCallback = useCallback(
    (toNodeId: string, toSide: CanvasSide) => {
      if (!drag) return
      if (drag.fromNodeId !== toNodeId) {
        addEdge(createCanvasEdge(drag.fromNodeId, toNodeId, drag.fromSide, toSide))
      }
      setDrag(null)
    },
    [drag, addEdge]
  )

  useEffect(() => {
    if (!drag) return

    const onMove = (e: PointerEvent) => {
      setDrag((prev) => prev ? { ...prev, cursorX: e.clientX, cursorY: e.clientY } : null)
    }
    const onUp = () => setDrag(null)

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
