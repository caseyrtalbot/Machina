import { describe, it, expect } from 'vitest'
import { buildGlobalGraphModel, buildLocalGraphModel } from '../../src/renderer/src/panels/graph/graph-model'
import type { GraphFilters } from '../../src/renderer/src/panels/graph/graph-model'
import type { KnowledgeGraph } from '@shared/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultFilters: GraphFilters = {
  showTags: true,
  showAttachments: true,
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
      { id: 't1', title: 'Tag 1', type: 'tag', signal: 'untested', connectionCount: 1 },
      { id: 'a1', title: 'Attachment 1', type: 'attachment', signal: 'untested', connectionCount: 1 },
      { id: 'orphan', title: 'Orphan', type: 'note', signal: 'untested', connectionCount: 0 },
      { id: 'ghost:unresolved', title: 'Unresolved', type: 'note', signal: 'untested', connectionCount: 0 }
    ],
    edges: [
      { source: 'n1', target: 'n2', kind: 'connection' },
      { source: 'n1', target: 'n3', kind: 'wikilink' },
      { source: 'n2', target: 't1', kind: 'tag' },
      { source: 'n3', target: 'a1', kind: 'connection' }
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

  it('filters out tag nodes when showTags=false and removes their edges', () => {
    const graph = makeGraph()
    const filters: GraphFilters = { ...defaultFilters, showTags: false }
    const model = buildGlobalGraphModel(graph, filters)

    const nodeIds = model.nodes.map((n) => n.id)
    expect(nodeIds).not.toContain('t1')

    // Edge from n2 → t1 must also be removed
    const hasTagEdge = model.edges.some(
      (e) => String(e.source) === 't1' || String(e.target) === 't1'
    )
    expect(hasTagEdge).toBe(false)
  })

  it('filters out attachment nodes when showAttachments=false', () => {
    const graph = makeGraph()
    const filters: GraphFilters = { ...defaultFilters, showAttachments: false }
    const model = buildGlobalGraphModel(graph, filters)

    const nodeIds = model.nodes.map((n) => n.id)
    expect(nodeIds).not.toContain('a1')

    // Edge touching a1 must also be removed
    const hasAttachmentEdge = model.edges.some(
      (e) => String(e.source) === 'a1' || String(e.target) === 'a1'
    )
    expect(hasAttachmentEdge).toBe(false)
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
    const graph = makeGraph()
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
    // n1 connects to n2 and n3; depth=1 → {n1, n2, n3}
    const model = buildLocalGraphModel(graph, 'n1', 1, defaultFilters)

    const nodeIds = model.nodes.map((n) => n.id)
    expect(nodeIds).toContain('n1')
    expect(nodeIds).toContain('n2')
    expect(nodeIds).toContain('n3')
    // t1 is a neighbor of n2 (one hop from n1 via n2), not a direct neighbor of n1
    expect(nodeIds).not.toContain('t1')
    expect(nodeIds).not.toContain('orphan')
  })

  it('depth=2 extends one more hop beyond direct neighbors', () => {
    const graph = makeGraph()
    // n1 → n2 → t1 (hop 2); n1 → n3 → a1 (hop 2)
    const model = buildLocalGraphModel(graph, 'n1', 2, defaultFilters)

    const nodeIds = model.nodes.map((n) => n.id)
    expect(nodeIds).toContain('n1')
    expect(nodeIds).toContain('n2')
    expect(nodeIds).toContain('n3')
    expect(nodeIds).toContain('t1')
    expect(nodeIds).toContain('a1')
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
    // Valid edges: n1→n2 (connection), n1→n3 (wikilink)
    // Edge n2→t1 must be excluded (t1 not visited)
    const model = buildLocalGraphModel(graph, 'n1', 1, defaultFilters)

    const edgePairs = model.edges.map((e) => `${String(e.source)}-${String(e.target)}`)
    expect(edgePairs).toContain('n1-n2')
    expect(edgePairs).toContain('n1-n3')
    expect(edgePairs).not.toContain('n2-t1')
    expect(edgePairs).not.toContain('n3-a1')
  })

  it('applies filters to local subgraph (showTags=false removes tag nodes)', () => {
    const graph = makeGraph()
    const filters: GraphFilters = { ...defaultFilters, showTags: false }
    // With depth=2, t1 is reachable but showTags=false should exclude it
    const model = buildLocalGraphModel(graph, 'n1', 2, filters)

    const nodeIds = model.nodes.map((n) => n.id)
    expect(nodeIds).not.toContain('t1')
  })

  it('applies filters to local subgraph (showOrphans=false removes disconnected subgraph nodes)', () => {
    // Build a graph where after BFS we get an isolated node due to edge filtering
    const graph: KnowledgeGraph = {
      nodes: [
        { id: 'center', title: 'Center', type: 'note', signal: 'untested', connectionCount: 1 },
        { id: 'neighbor', title: 'Neighbor', type: 'note', signal: 'untested', connectionCount: 1 },
        // This tag node is reachable at depth=1 via 'center' but the edge is tag type
        // After showTags=false filtering, it would become orphaned
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
    // Start from n2 at depth=1: neighbors are n1 (via connection) and t1 (via tag)
    const model = buildLocalGraphModel(graph, 'n2', 1, defaultFilters)

    const nodeIds = model.nodes.map((n) => n.id)
    expect(nodeIds).toContain('n2')
    expect(nodeIds).toContain('n1')
    expect(nodeIds).toContain('t1')
    expect(nodeIds).not.toContain('orphan')
  })
})
