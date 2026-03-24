import { describe, it, expect } from 'vitest'
import { serializeGraphSummary } from '../../src/renderer/src/engine/graph-summary'
import type { KnowledgeGraph, GraphNode, GraphEdge } from '../../src/shared/types'

function makeNode(overrides: Partial<GraphNode> & { id: string; title: string }): GraphNode {
  return {
    type: 'note',
    signal: 'untested',
    connectionCount: 0,
    ...overrides
  }
}

function makeEdge(
  source: string,
  target: string,
  kind: GraphEdge['kind'] = 'connection'
): GraphEdge {
  return { source, target, kind }
}

describe('serializeGraphSummary', () => {
  it('renders header with counts', () => {
    const graph: KnowledgeGraph = {
      nodes: [makeNode({ id: 'g01', title: 'Test' })],
      edges: []
    }

    const result = serializeGraphSummary(graph)

    expect(result).toContain('# Vault Graph Summary (1 nodes, 0 edges)')
  })

  it('formats nodes with type, tags, signal, and edge count', () => {
    const graph: KnowledgeGraph = {
      nodes: [
        makeNode({
          id: 'g01',
          title: 'Mental Models',
          type: 'gene',
          signal: 'validated',
          tags: ['thinking', 'decisions'],
          connectionCount: 5
        })
      ],
      edges: []
    }

    const result = serializeGraphSummary(graph)

    expect(result).toContain(
      '- g01 "Mental Models" [gene] tags:thinking,decisions signal:validated (5 edges)'
    )
  })

  it('formats edges with kind', () => {
    const graph: KnowledgeGraph = {
      nodes: [makeNode({ id: 'g01', title: 'A' }), makeNode({ id: 'g02', title: 'B' })],
      edges: [makeEdge('g01', 'g02', 'tension')]
    }

    const result = serializeGraphSummary(graph)

    expect(result).toContain('g01 --tension--> g02')
  })

  it('builds tag clusters for tags shared by 2+ nodes', () => {
    const graph: KnowledgeGraph = {
      nodes: [
        makeNode({ id: 'g01', title: 'A', tags: ['systems', 'unique-tag'] }),
        makeNode({ id: 'g02', title: 'B', tags: ['systems'] }),
        makeNode({ id: 'g03', title: 'C', tags: ['unique-tag-2'] })
      ],
      edges: []
    }

    const result = serializeGraphSummary(graph)

    expect(result).toContain('## Tag Clusters')
    expect(result).toContain('systems: g01, g02')
    // Single-use tags excluded
    expect(result).not.toContain('unique-tag:')
    expect(result).not.toContain('unique-tag-2:')
  })

  it('omits tag clusters section when disabled', () => {
    const graph: KnowledgeGraph = {
      nodes: [
        makeNode({ id: 'g01', title: 'A', tags: ['x'] }),
        makeNode({ id: 'g02', title: 'B', tags: ['x'] })
      ],
      edges: []
    }

    const result = serializeGraphSummary(graph, { includeTags: false })

    expect(result).not.toContain('## Tag Clusters')
  })

  it('truncates nodes when maxNodes is set', () => {
    const graph: KnowledgeGraph = {
      nodes: [
        makeNode({ id: 'g01', title: 'First' }),
        makeNode({ id: 'g02', title: 'Second' }),
        makeNode({ id: 'g03', title: 'Third' })
      ],
      edges: []
    }

    const result = serializeGraphSummary(graph, { maxNodes: 2 })

    expect(result).toContain('g01')
    expect(result).toContain('g02')
    expect(result).not.toContain('g03')
    expect(result).toContain('... and 1 more nodes')
    // Header still shows total count
    expect(result).toContain('3 nodes')
  })

  it('handles empty graph', () => {
    const graph: KnowledgeGraph = { nodes: [], edges: [] }

    const result = serializeGraphSummary(graph)

    expect(result).toContain('0 nodes, 0 edges')
    expect(result).not.toContain('## Tag Clusters')
  })

  it('omits tags field for nodes without tags', () => {
    const graph: KnowledgeGraph = {
      nodes: [makeNode({ id: 'n01', title: 'No Tags' })],
      edges: []
    }

    const result = serializeGraphSummary(graph)

    expect(result).toContain('- n01 "No Tags" [note] signal:untested')
    expect(result).not.toContain('tags:')
  })
})
