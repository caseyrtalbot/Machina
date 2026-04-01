import { describe, it, expect, beforeEach } from 'vitest'
import { useCanvasStore } from '../../src/renderer/src/store/canvas-store'

function makeNode(id: string, x: number, y: number) {
  return {
    id,
    type: 'text' as const,
    position: { x, y },
    size: { width: 200, height: 150 },
    content: '',
    metadata: {}
  }
}

describe('canvas-store moveNodes', () => {
  beforeEach(() => {
    useCanvasStore.setState(useCanvasStore.getInitialState())
  })

  it('moves multiple nodes in a single update', () => {
    const store = useCanvasStore.getState()
    store.addNode(makeNode('a', 0, 0))
    store.addNode(makeNode('b', 100, 100))
    store.addNode(makeNode('c', 200, 200))

    const updates = new Map([
      ['a', { x: 10, y: 20 }],
      ['b', { x: 110, y: 120 }]
    ])

    useCanvasStore.getState().moveNodes(updates)

    const nodes = useCanvasStore.getState().nodes
    expect(nodes.find((n) => n.id === 'a')?.position).toEqual({ x: 10, y: 20 })
    expect(nodes.find((n) => n.id === 'b')?.position).toEqual({ x: 110, y: 120 })
    // c should be unchanged
    expect(nodes.find((n) => n.id === 'c')?.position).toEqual({ x: 200, y: 200 })
  })

  it('preserves node references for unmoved nodes', () => {
    const store = useCanvasStore.getState()
    store.addNode(makeNode('a', 0, 0))
    store.addNode(makeNode('b', 100, 100))

    const nodesBefore = useCanvasStore.getState().nodes
    const bBefore = nodesBefore.find((n) => n.id === 'b')

    useCanvasStore.getState().moveNodes(new Map([['a', { x: 50, y: 50 }]]))

    const nodesAfter = useCanvasStore.getState().nodes
    const bAfter = nodesAfter.find((n) => n.id === 'b')

    // Reference equality: b was not moved, so same object
    expect(bAfter).toBe(bBefore)
  })

  it('sets isDirty and clears clusterLabels', () => {
    const store = useCanvasStore.getState()
    store.addNode(makeNode('a', 0, 0))
    useCanvasStore.setState({ isDirty: false })

    useCanvasStore.getState().moveNodes(new Map([['a', { x: 10, y: 10 }]]))

    expect(useCanvasStore.getState().isDirty).toBe(true)
    expect(useCanvasStore.getState().clusterLabels).toEqual([])
  })
})
