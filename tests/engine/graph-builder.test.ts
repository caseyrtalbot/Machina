import { describe, it, expect } from 'vitest'
import { buildGraph } from '@engine/graph-builder'
import type { Artifact } from '@shared/types'

function makeArtifact(
  overrides: Partial<Artifact> & { id: string; title: string; type: Artifact['type'] }
): Artifact {
  return {
    created: '2026-03-12',
    modified: '2026-03-12',
    signal: 'untested',
    tags: [],
    connections: [],
    clusters_with: [],
    tensions_with: [],
    appears_in: [],
    concepts: [],
    body: '',
    ...overrides
  }
}

describe('buildGraph', () => {
  it('creates nodes from artifacts', () => {
    const artifacts = [
      makeArtifact({ id: 'g1', title: 'Gene 1', type: 'gene' }),
      makeArtifact({ id: 'c1', title: 'Constraint 1', type: 'constraint' })
    ]
    const graph = buildGraph(artifacts)
    expect(graph.nodes).toHaveLength(2)
    expect(graph.nodes[0].id).toBe('g1')
    expect(graph.nodes[0].type).toBe('gene')
  })

  it('creates connection edges', () => {
    const artifacts = [
      makeArtifact({ id: 'g1', title: 'G1', type: 'gene', connections: ['g2'] }),
      makeArtifact({ id: 'g2', title: 'G2', type: 'gene' })
    ]
    const graph = buildGraph(artifacts)
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0]).toEqual({ source: 'g1', target: 'g2', kind: 'connection' })
  })

  it('creates cluster, tension, and appears_in edges', () => {
    const artifacts = [
      makeArtifact({
        id: 'g1',
        title: 'G1',
        type: 'gene',
        clusters_with: ['g2'],
        tensions_with: ['c1'],
        appears_in: ['i1']
      }),
      makeArtifact({ id: 'g2', title: 'G2', type: 'gene' }),
      makeArtifact({ id: 'c1', title: 'C1', type: 'constraint' }),
      makeArtifact({ id: 'i1', title: 'Index', type: 'index' })
    ]
    const graph = buildGraph(artifacts)
    const kinds = graph.edges.map((e) => e.kind)
    expect(kinds).toContain('cluster')
    expect(kinds).toContain('tension')
    expect(kinds).toContain('appears_in')
  })

  it('creates ghost nodes for missing references', () => {
    const artifacts = [makeArtifact({ id: 'g1', title: 'G1', type: 'gene', connections: ['g99'] })]
    const graph = buildGraph(artifacts)
    expect(graph.nodes).toHaveLength(2)
    const ghost = graph.nodes.find((n) => n.id === 'g99')
    expect(ghost).toBeDefined()
    expect(ghost!.title).toBe('g99')
    expect(ghost!.type).toBe('note')
  })

  it('counts connections correctly for node sizing', () => {
    const artifacts = [
      makeArtifact({ id: 'g1', title: 'G1', type: 'gene', connections: ['g2', 'g3'] }),
      makeArtifact({ id: 'g2', title: 'G2', type: 'gene', connections: ['g1'] }),
      makeArtifact({ id: 'g3', title: 'G3', type: 'gene' })
    ]
    const graph = buildGraph(artifacts)
    const g1 = graph.nodes.find((n) => n.id === 'g1')
    expect(g1!.connectionCount).toBe(2)
  })

  it('deduplicates edges', () => {
    const artifacts = [
      makeArtifact({ id: 'g1', title: 'G1', type: 'gene', connections: ['g2'] }),
      makeArtifact({ id: 'g2', title: 'G2', type: 'gene', connections: ['g1'] })
    ]
    const graph = buildGraph(artifacts)
    const connectionEdges = graph.edges.filter((e) => e.kind === 'connection')
    expect(connectionEdges).toHaveLength(1)
  })

  // --- Concept node edge tests ---

  it('creates concept edges by resolving title to ID', () => {
    const artifacts = [
      makeArtifact({
        id: 'g1',
        title: 'Gene One',
        type: 'gene',
        concepts: ['Gene Two']
      }),
      makeArtifact({ id: 'g2', title: 'Gene Two', type: 'gene' })
    ]
    const graph = buildGraph(artifacts)
    const conceptEdges = graph.edges.filter((e) => e.kind === 'concept')
    expect(conceptEdges).toHaveLength(1)
    expect(conceptEdges[0]).toEqual({ source: 'g1', target: 'g2', kind: 'concept' })
  })

  it('creates ghost nodes for unresolved concepts', () => {
    const artifacts = [
      makeArtifact({
        id: 'g1',
        title: 'Gene One',
        type: 'gene',
        concepts: ['Missing Note']
      })
    ]
    const graph = buildGraph(artifacts)
    const ghost = graph.nodes.find((n) => n.id === 'ghost:missing note')
    expect(ghost).toBeDefined()
    expect(ghost!.title).toBe('Missing Note')
    const conceptEdges = graph.edges.filter((e) => e.kind === 'concept')
    expect(conceptEdges).toHaveLength(1)
    expect(conceptEdges[0].target).toBe('ghost:missing note')
  })

  it('skips concept self-links', () => {
    const artifacts = [
      makeArtifact({
        id: 'g1',
        title: 'Gene One',
        type: 'gene',
        concepts: ['Gene One']
      })
    ]
    const graph = buildGraph(artifacts)
    expect(graph.edges).toHaveLength(0)
  })

  it('resolves concepts case-insensitively', () => {
    const artifacts = [
      makeArtifact({
        id: 'g1',
        title: 'Gene One',
        type: 'gene',
        concepts: ['gene two']
      }),
      makeArtifact({ id: 'g2', title: 'Gene Two', type: 'gene' })
    ]
    const graph = buildGraph(artifacts)
    const conceptEdges = graph.edges.filter((e) => e.kind === 'concept')
    expect(conceptEdges).toHaveLength(1)
    expect(conceptEdges[0].target).toBe('g2')
  })

  it('deduplicates concept against existing explicit connection', () => {
    const artifacts = [
      makeArtifact({
        id: 'g1',
        title: 'Gene One',
        type: 'gene',
        connections: ['g2'],
        concepts: ['Gene Two']
      }),
      makeArtifact({ id: 'g2', title: 'Gene Two', type: 'gene' })
    ]
    const graph = buildGraph(artifacts)
    // Should only have the explicit connection, no concept edge
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0].kind).toBe('connection')
  })

  it('deduplicates ghost nodes by case-insensitive ID', () => {
    const artifacts = [
      makeArtifact({
        id: 'g1',
        title: 'Gene One',
        type: 'gene',
        concepts: ['Strategy']
      }),
      makeArtifact({
        id: 'g2',
        title: 'Gene Two',
        type: 'gene',
        concepts: ['strategy']
      })
    ]
    const graph = buildGraph(artifacts)
    const ghosts = graph.nodes.filter((n) => n.id.startsWith('ghost:'))
    expect(ghosts).toHaveLength(1)
    expect(ghosts[0].id).toBe('ghost:strategy')
  })

  // --- Tag node tests ---

  it('creates tag nodes with tag: prefix', () => {
    const artifacts = [makeArtifact({ id: 'g1', title: 'G1', type: 'gene', tags: ['positioning'] })]
    const graph = buildGraph(artifacts)
    const tagNode = graph.nodes.find((n) => n.id === 'tag:positioning')
    expect(tagNode).toBeDefined()
    expect(tagNode!.title).toBe('#positioning')
    expect(tagNode!.type).toBe('tag')
    expect(tagNode!.signal).toBe('core')
  })

  it('creates tag edges between artifacts and tag nodes', () => {
    const artifacts = [makeArtifact({ id: 'g1', title: 'G1', type: 'gene', tags: ['moats'] })]
    const graph = buildGraph(artifacts)
    const tagEdges = graph.edges.filter((e) => e.kind === 'tag')
    expect(tagEdges).toHaveLength(1)
    expect(tagEdges[0]).toEqual({ source: 'g1', target: 'tag:moats', kind: 'tag' })
  })

  it('shares one tag node across multiple artifacts', () => {
    const artifacts = [
      makeArtifact({ id: 'g1', title: 'G1', type: 'gene', tags: ['strategy'] }),
      makeArtifact({ id: 'g2', title: 'G2', type: 'gene', tags: ['strategy'] })
    ]
    const graph = buildGraph(artifacts)
    const tagNodes = graph.nodes.filter((n) => n.type === 'tag')
    expect(tagNodes).toHaveLength(1)
    const tagEdges = graph.edges.filter((e) => e.kind === 'tag')
    expect(tagEdges).toHaveLength(2)
  })

  it('creates no tag nodes when no artifacts have tags', () => {
    const artifacts = [makeArtifact({ id: 'g1', title: 'G1', type: 'gene' })]
    const graph = buildGraph(artifacts)
    const tagNodes = graph.nodes.filter((n) => n.type === 'tag')
    expect(tagNodes).toHaveLength(0)
  })
})
