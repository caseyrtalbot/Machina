import { useCallback, useRef } from 'react'
import { useCanvasStore } from '../../store/canvas-store'
import { getMinSize, type CanvasNodeType } from '@shared/canvas-types'

export function useNodeDrag(nodeId: string) {
  const dragStart = useRef<{ x: number; y: number; nx: number; ny: number } | null>(null)

  const onDragStart = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation()
      const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId)
      if (!node) return

      const zoom = useCanvasStore.getState().viewport.zoom
      dragStart.current = { x: e.clientX, y: e.clientY, nx: node.position.x, ny: node.position.y }

      const onMove = (me: PointerEvent) => {
        if (!dragStart.current) return
        const dx = (me.clientX - dragStart.current.x) / zoom
        const dy = (me.clientY - dragStart.current.y) / zoom
        useCanvasStore.getState().moveNode(nodeId, {
          x: dragStart.current.nx + dx,
          y: dragStart.current.ny + dy
        })
      }

      const onUp = () => {
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
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [nodeId, nodeType]
  )

  return { onResizeStart }
}
