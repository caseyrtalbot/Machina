import { describe, it, expect } from 'vitest'
import { extractAgentContext } from '../../../../src/renderer/src/panels/canvas/agent-context'
import type { CanvasNode, CanvasEdge } from '@shared/canvas-types'

function makeNode(overrides: Partial<CanvasNode> & { id: string }): CanvasNode {
  return {
    type: 'text',
    position: { x: 0, y: 0 },
    size: { width: 200, height: 100 },
    content: `Content of ${overrides.id}`,
    metadata: {},
    ...overrides
  }
}

function makeEdge(from: string, to: string, kind = 'connection'): CanvasEdge {
  return {
    id: `${from}-${to}`,
    fromNode: from,
    toNode: to,
    fromSide: 'bottom',
    toSide: 'top',
    kind
  }
}

const viewport = { x: 0, y: 0, zoom: 1 }
const containerSize = { width: 1200, height: 800 }

describe('extractAgentContext', () => {
  it('returns selected cards with position and content', () => {
    const nodes = [makeNode({ id: 'a', content: 'Hello world' })]
    const edges: CanvasEdge[] = []
    const selectedIds = new Set(['a'])

    const ctx = extractAgentContext('challenge', nodes, edges, selectedIds, viewport, containerSize)

    expect(ctx.selectedCards).toHaveLength(1)
    expect(ctx.selectedCards[0].id).toBe('a')
    expect(ctx.selectedCards[0].body).toBe('Hello world')
  })

  it('extracts 1-hop neighbors connected by edges with correct edgeKind', () => {
    const nodes = [makeNode({ id: 'a' }), makeNode({ id: 'b' }), makeNode({ id: 'c' })]
    const edges = [makeEdge('a', 'b', 'connection'), makeEdge('c', 'a', 'tension')]
    const selectedIds = new Set(['a'])

    const ctx = extractAgentContext('challenge', nodes, edges, selectedIds, viewport, containerSize)

    expect(ctx.neighbors).toHaveLength(2)
    const neighborB = ctx.neighbors.find((n) => n.id === 'b')!
    const neighborC = ctx.neighbors.find((n) => n.id === 'c')!
    expect(neighborB.edgeKind).toBe('connection')
    expect(neighborC.edgeKind).toBe('tension')
  })

  it('does not include selected cards in neighbors', () => {
    const nodes = [makeNode({ id: 'a' }), makeNode({ id: 'b' })]
    const edges = [makeEdge('a', 'b')]
    const selectedIds = new Set(['a', 'b'])

    const ctx = extractAgentContext('challenge', nodes, edges, selectedIds, viewport, containerSize)

    expect(ctx.selectedCards).toHaveLength(2)
    expect(ctx.neighbors).toHaveLength(0)
  })

  it('includes edges between all included cards (selected + neighbors)', () => {
    const nodes = [makeNode({ id: 'a' }), makeNode({ id: 'b' }), makeNode({ id: 'c' })]
    const edges = [makeEdge('a', 'b'), makeEdge('b', 'c'), makeEdge('a', 'c')]
    const selectedIds = new Set(['a'])

    const ctx = extractAgentContext('challenge', nodes, edges, selectedIds, viewport, containerSize)

    // a is selected, b and c are neighbors (via edges a->b and a->c)
    // Edges a->b and a->c connect included cards. b->c also does (both are neighbors).
    expect(ctx.edges).toHaveLength(3)
  })

  it('excludes edges between non-included cards', () => {
    const nodes = [
      makeNode({ id: 'a' }),
      makeNode({ id: 'b' }),
      makeNode({ id: 'c' }),
      makeNode({ id: 'd' })
    ]
    // d is 2 hops from a -- not included
    const edges = [makeEdge('a', 'b'), makeEdge('c', 'd')]
    const selectedIds = new Set(['a'])

    const ctx = extractAgentContext('challenge', nodes, edges, selectedIds, viewport, containerSize)

    // Only edge a->b connects included cards
    expect(ctx.edges).toHaveLength(1)
    expect(ctx.edges[0].fromNode).toBe('a')
  })

  it('sets canvasMeta with viewport bounds and total card count', () => {
    const nodes = [makeNode({ id: 'a' }), makeNode({ id: 'b' }), makeNode({ id: 'c' })]
    const selectedIds = new Set(['a'])

    const ctx = extractAgentContext(
      'challenge',
      nodes,
      [],
      selectedIds,
      { x: -100, y: -50, zoom: 0.5 },
      { width: 1200, height: 800 }
    )

    expect(ctx.canvasMeta.totalCardCount).toBe(3)
    // Viewport bounds: origin = (-x/zoom, -y/zoom) = (200, 100)
    // size = (width/zoom, height/zoom) = (2400, 1600)
    expect(ctx.canvasMeta.viewportBounds.x).toBe(200)
    expect(ctx.canvasMeta.viewportBounds.y).toBe(100)
    expect(ctx.canvasMeta.viewportBounds.width).toBe(2400)
    expect(ctx.canvasMeta.viewportBounds.height).toBe(1600)
  })

  it('uses all canvas nodes when selection is empty (for tidy)', () => {
    const nodes = [makeNode({ id: 'a' }), makeNode({ id: 'b' })]
    const selectedIds = new Set<string>()

    const ctx = extractAgentContext('tidy', nodes, [], selectedIds, viewport, containerSize)

    expect(ctx.selectedCards).toHaveLength(2)
  })

  it('extracts filename stem as title for note-type cards', () => {
    const nodes = [makeNode({ id: 'a', type: 'note', content: 'path/to/my-idea.md' })]
    const selectedIds = new Set(['a'])

    const ctx = extractAgentContext('challenge', nodes, [], selectedIds, viewport, containerSize)

    expect(ctx.selectedCards[0].title).toBe('my-idea')
  })

  it('extracts first line truncated to 100 chars as title for text cards', () => {
    const longLine = 'A'.repeat(120) + '\nSecond line'
    const nodes = [makeNode({ id: 'a', type: 'text', content: longLine })]
    const selectedIds = new Set(['a'])

    const ctx = extractAgentContext('challenge', nodes, [], selectedIds, viewport, containerSize)

    expect(ctx.selectedCards[0].title).toBe('A'.repeat(100))
  })
})
