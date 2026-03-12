import { describe, it, expect } from 'vitest'
import { buildGraph } from '@engine/graph-builder'
import type { Artifact } from '@shared/types'

function makeArtifact(overrides: Partial<Artifact> & { id: string; title: string; type: Artifact['type'] }): Artifact {
  return {
    created: '2026-03-12', modified: '2026-03-12', signal: 'untested',
    tags: [], connections: [], clusters_with: [], tensions_with: [], appears_in: [],
    body: '', ...overrides,
  }
}

describe('buildGraph', () => {
  it('creates nodes from artifacts', () => {
    const artifacts = [
      makeArtifact({ id: 'g1', title: 'Gene 1', type: 'gene' }),
      makeArtifact({ id: 'c1', title: 'Constraint 1', type: 'constraint' }),
    ]
    const graph = buildGraph(artifacts)
    expect(graph.nodes).toHaveLength(2)
    expect(graph.nodes[0].id).toBe('g1')
    expect(graph.nodes[0].type).toBe('gene')
  })

  it('creates connection edges', () => {
    const artifacts = [
      makeArtifact({ id: 'g1', title: 'G1', type: 'gene', connections: ['g2'] }),
      makeArtifact({ id: 'g2', title: 'G2', type: 'gene' }),
    ]
    const graph = buildGraph(artifacts)
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0]).toEqual({ source: 'g1', target: 'g2', kind: 'connection' })
  })

  it('creates cluster, tension, and appears_in edges', () => {
    const artifacts = [
      makeArtifact({ id: 'g1', title: 'G1', type: 'gene', clusters_with: ['g2'], tensions_with: ['c1'], appears_in: ['i1'] }),
      makeArtifact({ id: 'g2', title: 'G2', type: 'gene' }),
      makeArtifact({ id: 'c1', title: 'C1', type: 'constraint' }),
      makeArtifact({ id: 'i1', title: 'Index', type: 'index' }),
    ]
    const graph = buildGraph(artifacts)
    const kinds = graph.edges.map(e => e.kind)
    expect(kinds).toContain('cluster')
    expect(kinds).toContain('tension')
    expect(kinds).toContain('appears_in')
  })

  it('creates ghost nodes for missing references', () => {
    const artifacts = [
      makeArtifact({ id: 'g1', title: 'G1', type: 'gene', connections: ['g99'] }),
    ]
    const graph = buildGraph(artifacts)
    expect(graph.nodes).toHaveLength(2)
    const ghost = graph.nodes.find(n => n.id === 'g99')
    expect(ghost).toBeDefined()
    expect(ghost!.title).toBe('g99')
    expect(ghost!.type).toBe('note')
  })

  it('counts connections correctly for node sizing', () => {
    const artifacts = [
      makeArtifact({ id: 'g1', title: 'G1', type: 'gene', connections: ['g2', 'g3'] }),
      makeArtifact({ id: 'g2', title: 'G2', type: 'gene', connections: ['g1'] }),
      makeArtifact({ id: 'g3', title: 'G3', type: 'gene' }),
    ]
    const graph = buildGraph(artifacts)
    const g1 = graph.nodes.find(n => n.id === 'g1')
    expect(g1!.connectionCount).toBe(2)
  })

  it('deduplicates edges', () => {
    const artifacts = [
      makeArtifact({ id: 'g1', title: 'G1', type: 'gene', connections: ['g2'] }),
      makeArtifact({ id: 'g2', title: 'G2', type: 'gene', connections: ['g1'] }),
    ]
    const graph = buildGraph(artifacts)
    const connectionEdges = graph.edges.filter(e => e.kind === 'connection')
    expect(connectionEdges).toHaveLength(1)
  })
})
