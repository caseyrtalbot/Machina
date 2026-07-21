import { describe, it, expect, beforeEach } from 'vitest'
import { DEFAULT_CANVAS_ID, getCanvasStore } from '../../src/renderer/src/store/canvas-store'

const store = getCanvasStore(DEFAULT_CANVAS_ID)

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
    store.setState(store.getInitialState())
  })

  it('moves multiple nodes in a single update', () => {
    const s = store.getState()
    s.addNode(makeNode('a', 0, 0))
    s.addNode(makeNode('b', 100, 100))
    s.addNode(makeNode('c', 200, 200))

    const updates = new Map([
      ['a', { x: 10, y: 20 }],
      ['b', { x: 110, y: 120 }]
    ])

    store.getState().moveNodes(updates)

    const nodes = store.getState().nodes
    expect(nodes.find((n) => n.id === 'a')?.position).toEqual({ x: 10, y: 20 })
    expect(nodes.find((n) => n.id === 'b')?.position).toEqual({ x: 110, y: 120 })
    // c should be unchanged
    expect(nodes.find((n) => n.id === 'c')?.position).toEqual({ x: 200, y: 200 })
  })

  it('preserves node references for unmoved nodes', () => {
    const s = store.getState()
    s.addNode(makeNode('a', 0, 0))
    s.addNode(makeNode('b', 100, 100))

    const nodesBefore = store.getState().nodes
    const bBefore = nodesBefore.find((n) => n.id === 'b')

    store.getState().moveNodes(new Map([['a', { x: 50, y: 50 }]]))

    const nodesAfter = store.getState().nodes
    const bAfter = nodesAfter.find((n) => n.id === 'b')

    // Reference equality: b was not moved, so same object
    expect(bAfter).toBe(bBefore)
  })

  it('sets isDirty and clears clusterLabels', () => {
    const s = store.getState()
    s.addNode(makeNode('a', 0, 0))
    store.setState({ isDirty: false })

    store.getState().moveNodes(new Map([['a', { x: 10, y: 10 }]]))

    expect(store.getState().isDirty).toBe(true)
    expect(store.getState().clusterLabels).toEqual([])
  })
})
