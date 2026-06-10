import { describe, it, expect, vi } from 'vitest'
import { GraphRenderer } from '@renderer/panels/graph/graph-renderer'
import type { RendererCallbacks, EdgeData } from '@renderer/panels/graph/graph-renderer'
import type { SimNode } from '@renderer/panels/graph/graph-types'

function makeCallbacks(): RendererCallbacks {
  return {
    onNodeHover: vi.fn(),
    onNodeClick: vi.fn(),
    onNodeOpen: vi.fn(),
    onNodeDrag: vi.fn(),
    onNodeDragEnd: vi.fn(),
    onViewportChange: vi.fn(),
    onDeselect: vi.fn()
  }
}

function makeNode(overrides: Partial<SimNode> & { index: number }): SimNode {
  return {
    id: `node-${overrides.index}`,
    type: 'note',
    signal: 'emerging',
    connectionCount: 2,
    isGhost: false,
    ...overrides
  }
}

describe('GraphRenderer', () => {
  it('can be constructed with callbacks', () => {
    const renderer = new GraphRenderer(makeCallbacks())
    expect(renderer).toBeDefined()
    expect(renderer.getNodeCount()).toBe(0)
  })

  it('accepts position data before mount', () => {
    const renderer = new GraphRenderer(makeCallbacks())
    const positions = new Float32Array([10, 20, 30, 40])
    renderer.setPositions(positions)
    // No error thrown, node count is still 0 (positions != nodes)
    expect(renderer.getNodeCount()).toBe(0)
  })

  it('accepts graph data before mount', () => {
    const renderer = new GraphRenderer(makeCallbacks())
    const nodes: SimNode[] = [makeNode({ index: 0 }), makeNode({ index: 1 })]
    const edges: EdgeData[] = [{ sourceIndex: 0, targetIndex: 1, kind: 'connection' }]

    renderer.setGraphData(nodes, edges)
    expect(renderer.getNodeCount()).toBe(2)
  })

  it('updates node count when graph data changes', () => {
    const renderer = new GraphRenderer(makeCallbacks())

    renderer.setGraphData([makeNode({ index: 0 })], [])
    expect(renderer.getNodeCount()).toBe(1)

    renderer.setGraphData(
      [makeNode({ index: 0 }), makeNode({ index: 1 }), makeNode({ index: 2 })],
      []
    )
    expect(renderer.getNodeCount()).toBe(3)
  })

  it('accepts setHighlightedNode without errors before mount', () => {
    const renderer = new GraphRenderer(makeCallbacks())
    // Should not throw even with no nodes or mount
    renderer.setHighlightedNode(0)
    renderer.setHighlightedNode(null)
  })

  it('destroy is safe to call without mount', () => {
    const renderer = new GraphRenderer(makeCallbacks())
    // Calling destroy without ever calling mount should not throw
    renderer.destroy()
  })

  it('centerOnNode pans the viewport so the node sits at center', () => {
    const callbacks = makeCallbacks()
    const renderer = new GraphRenderer(callbacks)
    renderer.setGraphData([makeNode({ index: 0 }), makeNode({ index: 1 })], [])
    renderer.setPositions(new Float32Array([100, 200, -40, 60]))

    renderer.centerOnNode(1)

    // scale floors at 1; viewport offset is the negated node position * scale
    expect(callbacks.onViewportChange).toHaveBeenCalledWith({ x: 40, y: -60, scale: 1 })
  })

  it('centerOnNode is a no-op when the node has no position yet', () => {
    const callbacks = makeCallbacks()
    const renderer = new GraphRenderer(callbacks)
    renderer.setGraphData([makeNode({ index: 0 })], [])

    renderer.centerOnNode(0)

    expect(callbacks.onViewportChange).not.toHaveBeenCalled()
  })

  it('setPositions replaces buffer without affecting node count', () => {
    const renderer = new GraphRenderer(makeCallbacks())
    renderer.setGraphData([makeNode({ index: 0 })], [])
    expect(renderer.getNodeCount()).toBe(1)

    renderer.setPositions(new Float32Array([100, 200]))
    // Node count comes from setGraphData, not positions
    expect(renderer.getNodeCount()).toBe(1)
  })

  it('handles empty graph data', () => {
    const renderer = new GraphRenderer(makeCallbacks())
    renderer.setGraphData([], [])
    expect(renderer.getNodeCount()).toBe(0)
  })

  it('handles ghost nodes in graph data', () => {
    const renderer = new GraphRenderer(makeCallbacks())
    const nodes: SimNode[] = [
      makeNode({ index: 0, isGhost: true }),
      makeNode({ index: 1, isGhost: false })
    ]
    renderer.setGraphData(nodes, [])
    expect(renderer.getNodeCount()).toBe(2)
  })

  describe('RendererCallbacks interface', () => {
    it('requires onDeselect in callbacks', () => {
      const callbacks = makeCallbacks()
      // onDeselect must be present in the interface
      expect(callbacks.onDeselect).toBeDefined()
      expect(typeof callbacks.onDeselect).toBe('function')
    })

    it('constructs with onDeselect callback', () => {
      const callbacks = makeCallbacks()
      const renderer = new GraphRenderer(callbacks)
      expect(renderer).toBeDefined()
    })
  })
})
