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
    wikilinks: [],
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

  // --- Wikilink edge tests ---

  it('creates wikilink edges by resolving title to ID', () => {
    const artifacts = [
      makeArtifact({
        id: 'g1',
        title: 'Gene One',
        type: 'gene',
        wikilinks: ['Gene Two']
      }),
      makeArtifact({ id: 'g2', title: 'Gene Two', type: 'gene' })
    ]
    const graph = buildGraph(artifacts)
    const wikilinkEdges = graph.edges.filter((e) => e.kind === 'wikilink')
    expect(wikilinkEdges).toHaveLength(1)
    expect(wikilinkEdges[0]).toEqual({ source: 'g1', target: 'g2', kind: 'wikilink' })
  })

  it('creates ghost nodes for unresolved wikilinks', () => {
    const artifacts = [
      makeArtifact({
        id: 'g1',
        title: 'Gene One',
        type: 'gene',
        wikilinks: ['Missing Note']
      })
    ]
    const graph = buildGraph(artifacts)
    const ghost = graph.nodes.find((n) => n.id === 'ghost:Missing Note')
    expect(ghost).toBeDefined()
    expect(ghost!.title).toBe('Missing Note')
    const wikilinkEdges = graph.edges.filter((e) => e.kind === 'wikilink')
    expect(wikilinkEdges).toHaveLength(1)
    expect(wikilinkEdges[0].target).toBe('ghost:Missing Note')
  })

  it('skips wikilink self-links', () => {
    const artifacts = [
      makeArtifact({
        id: 'g1',
        title: 'Gene One',
        type: 'gene',
        wikilinks: ['Gene One']
      })
    ]
    const graph = buildGraph(artifacts)
    expect(graph.edges).toHaveLength(0)
  })

  it('resolves wikilinks case-insensitively', () => {
    const artifacts = [
      makeArtifact({
        id: 'g1',
        title: 'Gene One',
        type: 'gene',
        wikilinks: ['gene two']
      }),
      makeArtifact({ id: 'g2', title: 'Gene Two', type: 'gene' })
    ]
    const graph = buildGraph(artifacts)
    const wikilinkEdges = graph.edges.filter((e) => e.kind === 'wikilink')
    expect(wikilinkEdges).toHaveLength(1)
    expect(wikilinkEdges[0].target).toBe('g2')
  })

  it('deduplicates wikilink against existing explicit connection', () => {
    const artifacts = [
      makeArtifact({
        id: 'g1',
        title: 'Gene One',
        type: 'gene',
        connections: ['g2'],
        wikilinks: ['Gene Two']
      }),
      makeArtifact({ id: 'g2', title: 'Gene Two', type: 'gene' })
    ]
    const graph = buildGraph(artifacts)
    // Should only have the explicit connection, no wikilink edge
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0].kind).toBe('connection')
  })

  // --- Tag node tests ---

  it('creates tag nodes with tag: prefix', () => {
    const artifacts = [
      makeArtifact({ id: 'g1', title: 'G1', type: 'gene', tags: ['positioning'] })
    ]
    const graph = buildGraph(artifacts)
    const tagNode = graph.nodes.find((n) => n.id === 'tag:positioning')
    expect(tagNode).toBeDefined()
    expect(tagNode!.title).toBe('#positioning')
    expect(tagNode!.type).toBe('tag')
    expect(tagNode!.signal).toBe('core')
  })

  it('creates tag edges between artifacts and tag nodes', () => {
    const artifacts = [
      makeArtifact({ id: 'g1', title: 'G1', type: 'gene', tags: ['moats'] })
    ]
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
    const artifacts = [
      makeArtifact({ id: 'g1', title: 'G1', type: 'gene' })
    ]
    const graph = buildGraph(artifacts)
    const tagNodes = graph.nodes.filter((n) => n.type === 'tag')
    expect(tagNodes).toHaveLength(0)
  })
})
