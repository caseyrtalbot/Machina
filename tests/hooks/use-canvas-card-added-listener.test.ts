import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useCanvasStore } from '../../src/renderer/src/store/canvas-store'
import type { CanvasNode } from '../../src/shared/canvas-types'
import { useCanvasCardAddedListener } from '../../src/renderer/src/hooks/use-canvas-card-added-listener'

const node: CanvasNode = {
  id: 'pin_1',
  type: 'text',
  position: { x: 10, y: 20 },
  size: { width: 260, height: 140 },
  content: 'Pinned note',
  metadata: { refs: ['notes/a.md'] }
}

function dispatchCardAdded(detail: {
  readonly canvasId: string
  readonly cardId: string
  readonly node?: CanvasNode
}): void {
  window.dispatchEvent(new CustomEvent('machina:canvas:card-added', { detail }))
}

describe('useCanvasCardAddedListener', () => {
  beforeEach(() => {
    useCanvasStore.setState(useCanvasStore.getInitialState())
  })

  afterEach(() => {
    useCanvasStore.setState(useCanvasStore.getInitialState())
  })

  it('adds the pinned node to the matching live canvas', () => {
    renderHook(() => useCanvasCardAddedListener('default'))

    dispatchCardAdded({ canvasId: 'default', cardId: node.id, node })

    const state = useCanvasStore.getState()
    expect(state.nodes).toEqual([node])
    expect([...state.selectedNodeIds]).toEqual([node.id])
  })

  it('ignores events for another canvas', () => {
    renderHook(() => useCanvasCardAddedListener('default'))

    dispatchCardAdded({ canvasId: 'side', cardId: node.id, node })

    expect(useCanvasStore.getState().nodes).toEqual([])
  })

  it('does not duplicate an already-added node', () => {
    renderHook(() => useCanvasCardAddedListener('default'))

    dispatchCardAdded({ canvasId: 'default', cardId: node.id, node })
    dispatchCardAdded({ canvasId: 'default', cardId: node.id, node })

    expect(useCanvasStore.getState().nodes).toHaveLength(1)
  })
})
