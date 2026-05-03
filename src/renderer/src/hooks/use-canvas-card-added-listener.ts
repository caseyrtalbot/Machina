import { useEffect } from 'react'
import type { CanvasNode } from '@shared/canvas-types'
import { useCanvasStore } from '../store/canvas-store'

interface CardAddedDetail {
  readonly canvasId: string
  readonly cardId: string
  readonly node?: CanvasNode
}

export function useCanvasCardAddedListener(canvasId: string): void {
  useEffect(() => {
    const handleCardAdded = (event: Event) => {
      const detail = (event as CustomEvent<CardAddedDetail>).detail
      if (!detail || detail.canvasId !== canvasId || !detail.node) return

      const store = useCanvasStore.getState()
      if (store.nodes.some((node) => node.id === detail.node!.id)) return

      store.addNode(detail.node)
      store.setSelection(new Set([detail.node.id]))
      store.centerOnNode?.(detail.node.id)
    }

    window.addEventListener('machina:canvas:card-added', handleCardAdded)
    return () => window.removeEventListener('machina:canvas:card-added', handleCardAdded)
  }, [canvasId])
}
