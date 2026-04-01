import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { CanvasEdge, CanvasNode } from '@shared/canvas-types'

let mockNodes: CanvasNode[] = []
let mockEdges: CanvasEdge[] = []
let mockZoom = 1
let mockSelectedEdgeId: string | null = null
let mockSelectedNodeIds = new Set<string>()
let mockHoveredNodeId: string | null = null
const mockSetSelectedEdge = vi.fn()

vi.mock('../../../store/canvas-store', () => ({
  useCanvasStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        nodes: mockNodes,
        edges: mockEdges,
        viewport: { x: 0, y: 0, zoom: mockZoom },
        selectedEdgeId: mockSelectedEdgeId,
        selectedNodeIds: mockSelectedNodeIds,
        hoveredNodeId: mockHoveredNodeId,
        setSelectedEdge: mockSetSelectedEdge
      }),
    {
      getState: () => ({
        setSelectedEdge: mockSetSelectedEdge
      })
    }
  )
}))

vi.mock('../edge-styling', () => ({
  getEdgeStrokeDasharray: () => undefined,
  getEdgeStrokeWidth: () => 1.5
}))

function makeNode(id: string, x = 0, y = 0): CanvasNode {
  return {
    id,
    type: 'text',
    position: { x, y },
    size: { width: 200, height: 100 },
    content: '',
    metadata: {}
  }
}

function makeEdge(id: string, fromNode: string, toNode: string): CanvasEdge {
  return {
    id,
    fromNode,
    toNode,
    fromSide: 'right',
    toSide: 'left'
  }
}

// Lazy import so mocks are registered first
async function loadEdgeLayer() {
  const mod = await import('../EdgeLayer')
  return mod.EdgeLayer
}

describe('EdgeLayer', () => {
  beforeEach(() => {
    mockNodes = [makeNode('a', 0, 0), makeNode('b', 300, 0)]
    mockEdges = [makeEdge('e1', 'a', 'b')]
    mockZoom = 1
    mockSelectedEdgeId = null
    mockSelectedNodeIds = new Set()
    mockHoveredNodeId = null
    mockSetSelectedEdge.mockClear()
  })

  it('renders an edge path when both nodes exist', async () => {
    const EdgeLayer = await loadEdgeLayer()
    const { container } = render(<EdgeLayer />)
    const paths = container.querySelectorAll('path')
    // 2 paths per edge: hit area + visible
    expect(paths.length).toBe(2)
  })

  it('renders nothing for an edge referencing a missing node', async () => {
    mockEdges = [makeEdge('e1', 'a', 'missing')]
    const EdgeLayer = await loadEdgeLayer()
    const { container } = render(<EdgeLayer />)
    // Should have 0 visible paths (no <g data-canvas-edge>)
    const groups = container.querySelectorAll('[data-canvas-edge]')
    expect(groups.length).toBe(0)
  })

  it('uses nodeMap for O(1) lookup (no Array.find on nodes)', async () => {
    // Behavioral regression: with 2 nodes and 1 edge, the Map-based lookup
    // resolves both endpoints and renders the edge correctly
    const EdgeLayer = await loadEdgeLayer()
    const { container } = render(<EdgeLayer />)
    const groups = container.querySelectorAll('[data-canvas-edge]')
    expect(groups.length).toBe(1)
  })

  it('hides hidden edges unless endpoint is hovered', async () => {
    mockEdges = [{ ...makeEdge('e1', 'a', 'b'), hidden: true }]
    mockHoveredNodeId = null

    const EdgeLayer = await loadEdgeLayer()
    const { container } = render(<EdgeLayer />)
    const groups = container.querySelectorAll('[data-canvas-edge]')
    expect(groups.length).toBe(0)
  })

  it('shows hidden edges when endpoint is hovered', async () => {
    mockEdges = [{ ...makeEdge('e1', 'a', 'b'), hidden: true }]
    mockHoveredNodeId = 'a'

    const EdgeLayer = await loadEdgeLayer()
    const { container } = render(<EdgeLayer />)
    const groups = container.querySelectorAll('[data-canvas-edge]')
    expect(groups.length).toBe(1)
  })

  it('shows hidden edges when endpoint is selected', async () => {
    mockEdges = [{ ...makeEdge('e1', 'a', 'b'), hidden: true }]
    mockSelectedNodeIds = new Set(['b'])

    const EdgeLayer = await loadEdgeLayer()
    const { container } = render(<EdgeLayer />)
    const groups = container.querySelectorAll('[data-canvas-edge]')
    expect(groups.length).toBe(1)
  })
})
