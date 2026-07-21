import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { CanvasEdge, CanvasNode } from '@shared/canvas-types'
import { DEFAULT_CANVAS_ID, getCanvasStore } from '../../../store/canvas-store'
import { CanvasStoreProvider } from '../canvas-store-context'

let mockNodes: CanvasNode[] = []
let mockEdges: CanvasEdge[] = []
let mockZoom = 1
let mockSelectedEdgeId: string | null = null
let mockSelectedNodeIds = new Set<string>()
let mockHoveredNodeId: string | null = null
let mockShowAllEdges = false
const mockSetSelectedEdge = vi.fn()

function seedCanvasStore(): void {
  const store = getCanvasStore(DEFAULT_CANVAS_ID)
  store.setState({
    ...store.getInitialState(),
    nodes: mockNodes,
    edges: mockEdges,
    viewport: { x: 0, y: 0, zoom: mockZoom },
    selectedEdgeId: mockSelectedEdgeId,
    selectedNodeIds: mockSelectedNodeIds,
    hoveredNodeId: mockHoveredNodeId,
    showAllEdges: mockShowAllEdges,
    setSelectedEdge: mockSetSelectedEdge
  })
}

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

function makeEdge(
  id: string,
  fromNode: string,
  toNode: string,
  kind?: CanvasEdge['kind']
): CanvasEdge {
  return {
    id,
    fromNode,
    toNode,
    fromSide: 'right',
    toSide: 'left',
    kind
  }
}

// Lazy import so mocks are registered first
async function renderEdgeLayer() {
  const { EdgeLayer } = await import('../EdgeLayer')
  seedCanvasStore()
  return render(
    <CanvasStoreProvider canvasId={DEFAULT_CANVAS_ID}>
      <EdgeLayer />
    </CanvasStoreProvider>
  )
}

describe('EdgeLayer', () => {
  beforeEach(() => {
    mockNodes = [makeNode('a', 0, 0), makeNode('b', 300, 0)]
    mockEdges = [makeEdge('e1', 'a', 'b')]
    mockZoom = 1
    mockSelectedEdgeId = null
    mockSelectedNodeIds = new Set()
    mockHoveredNodeId = null
    mockShowAllEdges = false
    mockSetSelectedEdge.mockClear()
  })

  it('renders an edge path when both nodes exist', async () => {
    mockShowAllEdges = true
    const { container } = await renderEdgeLayer()
    const paths = container.querySelectorAll('path')
    // 2 paths per edge: hit area + visible (showAllEdges reveals the visible path)
    expect(paths.length).toBe(2)
  })

  it('renders nothing for an edge referencing a missing node', async () => {
    mockEdges = [makeEdge('e1', 'a', 'missing')]
    const { container } = await renderEdgeLayer()
    // Should have 0 visible paths (no <g data-canvas-edge>)
    const groups = container.querySelectorAll('[data-canvas-edge]')
    expect(groups.length).toBe(0)
  })

  it('uses nodeMap for O(1) lookup (no Array.find on nodes)', async () => {
    // Behavioral regression: with 2 nodes and 1 edge, the Map-based lookup
    // resolves both endpoints and renders the edge correctly
    mockEdges = [makeEdge('e1', 'a', 'b', 'connection')]
    const { container } = await renderEdgeLayer()
    const groups = container.querySelectorAll('[data-canvas-edge]')
    expect(groups.length).toBe(1)
  })

  it('renders user-created edges at low opacity when not revealed', async () => {
    mockEdges = [makeEdge('e1', 'a', 'b', 'connection')]
    mockHoveredNodeId = null

    const { container } = await renderEdgeLayer()
    // Hit path + visible path both mount for baseline-visible user edges
    const paths = container.querySelectorAll('path')
    expect(paths.length).toBe(2)
    expect(paths[1].getAttribute('opacity')).toBe('0.25')
  })

  it('mounts no paths at all for unrevealed structural edges', async () => {
    // Previously the 12px invisible hit path always mounted, so unseen
    // edges could be selected and deleted. Now nothing mounts.
    mockEdges = [makeEdge('e1', 'a', 'b', 'imports')]
    mockZoom = 0.5

    const { container } = await renderEdgeLayer()
    expect(container.querySelectorAll('[data-canvas-edge]').length).toBe(0)
    expect(container.querySelectorAll('path').length).toBe(0)
  })

  it('reveals structural edges on endpoint hover with full demand opacity', async () => {
    mockEdges = [makeEdge('e1', 'a', 'b', 'imports')]
    mockZoom = 0.5
    mockHoveredNodeId = 'a'

    const { container } = await renderEdgeLayer()
    const paths = container.querySelectorAll('path')
    expect(paths.length).toBe(2)
    expect(paths[1].getAttribute('opacity')).toBe('0.6')
  })

  it('shows hidden edges when endpoint is hovered', async () => {
    mockEdges = [{ ...makeEdge('e1', 'a', 'b'), hidden: true }]
    mockHoveredNodeId = 'a'

    const { container } = await renderEdgeLayer()
    const groups = container.querySelectorAll('[data-canvas-edge]')
    expect(groups.length).toBe(1)
  })

  it('shows hidden edges when endpoint is selected', async () => {
    mockEdges = [{ ...makeEdge('e1', 'a', 'b'), hidden: true }]
    mockSelectedNodeIds = new Set(['b'])

    const { container } = await renderEdgeLayer()
    const groups = container.querySelectorAll('[data-canvas-edge]')
    expect(groups.length).toBe(1)
  })
})
