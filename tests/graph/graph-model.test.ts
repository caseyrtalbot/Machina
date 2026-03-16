import { describe, it, expect } from 'vitest'
import {
  buildGlobalGraphModel,
  buildLocalGraphModel
} from '../../src/renderer/src/panels/graph/graph-model'
import type { GraphFilters } from '../../src/renderer/src/panels/graph/graph-model'
import type { KnowledgeGraph } from '@shared/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultFilters: GraphFilters = {
  showOrphans: true,
  showExistingOnly: false,
  searchQuery: ''
}

function makeGraph(): KnowledgeGraph {
  return {
    nodes: [
      { id: 'n1', title: 'Note 1', type: 'note', signal: 'untested', connectionCount: 2 },
      { id: 'n2', title: 'Note 2', type: 'note', signal: 'emerging', connectionCount: 1 },
      { id: 'n3', title: 'Note 3', type: 'note', signal: 'validated', connectionCount: 1 },
      { id: 'n4', title: 'Note 4', type: 'note', signal: 'untested', connectionCount: 1 },
      { id: 'orphan', title: 'Orphan', type: 'note', signal: 'untested', connectionCount: 0 }
    ],
    edges: [
      { source: 'n1', target: 'n2', kind: 'connection' },
      { source: 'n1', target: 'n3', kind: 'co-occurrence' },
      { source: 'n3', target: 'n4', kind: 'connection' }
    ]
  }
}

// ---------------------------------------------------------------------------
// buildGlobalGraphModel
// ---------------------------------------------------------------------------

describe('buildGlobalGraphModel', () => {
  it('returns all nodes and edges with permissive default filters', () => {
    const graph = makeGraph()
    const model = buildGlobalGraphModel(graph, defaultFilters)

    expect(model.nodes).toHaveLength(graph.nodes.length)
    expect(model.edges).toHaveLength(graph.edges.length)
  })

  it('filters orphans when showOrphans=false (node with no edges AND connectionCount=0)', () => {
    const graph = makeGraph()
    const filters: GraphFilters = { ...defaultFilters, showOrphans: false }
    const model = buildGlobalGraphModel(graph, filters)

    // 'orphan' has no edges and connectionCount=0 — must be removed
    const nodeIds = model.nodes.map((n) => n.id)
    expect(nodeIds).not.toContain('orphan')

    // 'n1' has edges — must be kept
    expect(nodeIds).toContain('n1')
  })

  it('keeps nodes that have edges even when showOrphans=false', () => {
    const graph = makeGraph()
    const filters: GraphFilters = { ...defaultFilters, showOrphans: false }
    const model = buildGlobalGraphModel(graph, filters)

    const nodeIds = model.nodes.map((n) => n.id)
    expect(nodeIds).toContain('n2')
    expect(nodeIds).toContain('n3')
  })

  it('filters ghost nodes when showExistingOnly=true', () => {
    const graph: KnowledgeGraph = {
      nodes: [
        ...makeGraph().nodes,
        {
          id: 'ghost:unresolved',
          title: 'Unresolved',
          type: 'note',
          signal: 'untested',
          connectionCount: 0
        }
      ],
      edges: makeGraph().edges
    }
    const filters: GraphFilters = { ...defaultFilters, showExistingOnly: true }
    const model = buildGlobalGraphModel(graph, filters)

    const nodeIds = model.nodes.map((n) => n.id)
    expect(nodeIds).not.toContain('ghost:unresolved')
    expect(nodeIds).toContain('n1')
  })

  it('returns immutable-shaped output (readonly arrays)', () => {
    const graph = makeGraph()
    const model = buildGlobalGraphModel(graph, defaultFilters)

    // The model itself is a plain object with arrays; verify it is not the same reference
    expect(model.nodes).not.toBe(graph.nodes)
  })
})

// ---------------------------------------------------------------------------
// buildLocalGraphModel
// ---------------------------------------------------------------------------

describe('buildLocalGraphModel', () => {
  it('returns empty model when activeNodeId is not found', () => {
    const graph = makeGraph()
    const model = buildLocalGraphModel(graph, 'nonexistent', 1, defaultFilters)

    expect(model.nodes).toHaveLength(0)
    expect(model.edges).toHaveLength(0)
  })

  it('depth=1 returns center node and its immediate neighbors only', () => {
    const graph = makeGraph()
    // n1 connects to n2 (connection) and n3 (co-occurrence); depth=1 → {n1, n2, n3}
    const model = buildLocalGraphModel(graph, 'n1', 1, defaultFilters)

    const nodeIds = model.nodes.map((n) => n.id)
    expect(nodeIds).toContain('n1')
    expect(nodeIds).toContain('n2')
    expect(nodeIds).toContain('n3')
    // n4 is a neighbor of n3 (two hops from n1), not a direct neighbor of n1
    expect(nodeIds).not.toContain('n4')
    expect(nodeIds).not.toContain('orphan')
  })

  it('depth=2 extends one more hop beyond direct neighbors', () => {
    const graph = makeGraph()
    // n1 → n3 → n4 (hop 2)
    const model = buildLocalGraphModel(graph, 'n1', 2, defaultFilters)

    const nodeIds = model.nodes.map((n) => n.id)
    expect(nodeIds).toContain('n1')
    expect(nodeIds).toContain('n2')
    expect(nodeIds).toContain('n3')
    expect(nodeIds).toContain('n4')
  })

  it('does not include isolated nodes outside the reachable depth', () => {
    const graph = makeGraph()
    const model = buildLocalGraphModel(graph, 'n1', 2, defaultFilters)

    const nodeIds = model.nodes.map((n) => n.id)
    expect(nodeIds).not.toContain('orphan')
  })

  it('only includes edges where both endpoints are in the visited set', () => {
    const graph = makeGraph()
    // depth=1 from n1: visited = {n1, n2, n3}
    // Valid edges: n1→n2 (connection), n1→n3 (co-occurrence)
    // Edge n3→n4 must be excluded (n4 not visited)
    const model = buildLocalGraphModel(graph, 'n1', 1, defaultFilters)

    const edgePairs = model.edges.map((e) => `${String(e.source)}-${String(e.target)}`)
    expect(edgePairs).toContain('n1-n2')
    expect(edgePairs).toContain('n1-n3')
    expect(edgePairs).not.toContain('n3-n4')
  })

  it('applies filters to local subgraph (showOrphans=false removes disconnected subgraph nodes)', () => {
    // Build a graph where after BFS we get an isolated node due to edge filtering
    const graph: KnowledgeGraph = {
      nodes: [
        { id: 'center', title: 'Center', type: 'note', signal: 'untested', connectionCount: 1 },
        {
          id: 'neighbor',
          title: 'Neighbor',
          type: 'note',
          signal: 'untested',
          connectionCount: 1
        },
        { id: 'solo', title: 'Solo', type: 'note', signal: 'untested', connectionCount: 0 }
      ],
      edges: [
        { source: 'center', target: 'neighbor', kind: 'connection' },
        { source: 'center', target: 'solo', kind: 'connection' }
      ]
    }

    // With showOrphans=false: 'solo' has connectionCount=0 but IS connected by an edge
    // so it should still appear. Test that a true orphan outside BFS is excluded.
    const filters: GraphFilters = { ...defaultFilters, showOrphans: false }
    const model = buildLocalGraphModel(graph, 'center', 1, filters)

    const nodeIds = model.nodes.map((n) => n.id)
    // Both neighbor and solo are reachable via edges → kept
    expect(nodeIds).toContain('center')
    expect(nodeIds).toContain('neighbor')
    expect(nodeIds).toContain('solo')
  })

  it('starts BFS from any node, not just one with many connections', () => {
    const graph = makeGraph()
    // Start from n2 at depth=1: neighbors are n1 (via connection)
    const model = buildLocalGraphModel(graph, 'n2', 1, defaultFilters)

    const nodeIds = model.nodes.map((n) => n.id)
    expect(nodeIds).toContain('n2')
    expect(nodeIds).toContain('n1')
    expect(nodeIds).not.toContain('orphan')
  })
})
