import { useState, useCallback, useRef } from 'react'
import { useCanvasStore } from '../../store/canvas-store'

interface SelectionRect {
  startX: number
  startY: number
  endX: number
  endY: number
}

/** Minimum drag distance (px) before it counts as a selection rectangle vs a click. */
const MIN_DRAG_DISTANCE = 5

export function useCanvasSelection() {
  const [rect, setRect] = useState<SelectionRect | null>(null)
  const isDragging = useRef(false)
  const didDragRef = useRef(false)

  const onSelectionStart = useCallback((e: React.PointerEvent) => {
    // Only left-click on background, no space (that's panning)
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('[data-canvas-node]')) return

    isDragging.current = true
    didDragRef.current = false
    const startX = e.clientX
    const startY = e.clientY
    setRect({ startX, startY, endX: startX, endY: startY })

    const onMove = (me: PointerEvent) => {
      if (!isDragging.current) return
      // Only count as a drag after minimum distance
      const dx = me.clientX - startX
      const dy = me.clientY - startY
      if (Math.abs(dx) > MIN_DRAG_DISTANCE || Math.abs(dy) > MIN_DRAG_DISTANCE) {
        didDragRef.current = true
      }
      setRect((prev) => (prev ? { ...prev, endX: me.clientX, endY: me.clientY } : null))
    }

    const onUp = (me: PointerEvent) => {
      isDragging.current = false
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)

      // If the user barely moved, treat it as a click (not a selection drag)
      if (!didDragRef.current) {
        setRect(null)
        return
      }

      // Calculate which nodes intersect the rect
      const { nodes, viewport, setSelection } = useCanvasStore.getState()
      const container = document.querySelector('[data-canvas-surface]')
      if (!container) {
        setRect(null)
        return
      }

      const containerRect = container.getBoundingClientRect()
      const minX = Math.min(startX, me.clientX)
      const maxX = Math.max(startX, me.clientX)
      const minY = Math.min(startY, me.clientY)
      const maxY = Math.max(startY, me.clientY)

      // Convert screen rect to canvas coords
      const cMinX = (minX - containerRect.left - viewport.x) / viewport.zoom
      const cMaxX = (maxX - containerRect.left - viewport.x) / viewport.zoom
      const cMinY = (minY - containerRect.top - viewport.y) / viewport.zoom
      const cMaxY = (maxY - containerRect.top - viewport.y) / viewport.zoom

      const selected = new Set<string>()
      for (const node of nodes) {
        const nx = node.position.x
        const ny = node.position.y
        const nw = node.size.width
        const nh = node.size.height

        // Check AABB intersection
        if (nx + nw > cMinX && nx < cMaxX && ny + nh > cMinY && ny < cMaxY) {
          selected.add(node.id)
        }
      }

      setSelection(selected)
      setRect(null)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [])

  /**
   * Returns true if the last pointer interaction was a selection drag.
   * Used by the click handler to suppress clearSelection after drag-to-select.
   */
  const wasSelectionDrag = useCallback(() => didDragRef.current, [])

  return { rect, onSelectionStart, wasSelectionDrag }
}
