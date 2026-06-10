import { describe, it, expect } from 'vitest'
import { buildGraph } from '@engine/graph-builder'
import type { Artifact } from '@shared/types'

function makeArtifact(overrides: Partial<Artifact> & { id: string }): Artifact {
  return {
    title: overrides.id,
    type: 'note',
    created: '2026-01-01',
    modified: '2026-01-01',
    signal: 'untested',
    tags: [],
    connections: [],
    clusters_with: [],
    tensions_with: [],
    appears_in: [],
    related: [],
    bodyLinks: [],
    concepts: [],
    body: '',
    frontmatter: {},
    ...overrides
  }
}

describe('buildGraph case-insensitive bodyLinks', () => {
  it('resolves bodyLink to existing node via case-insensitive match', () => {
    const artifacts: Artifact[] = [
      makeArtifact({ id: 'Foo', bodyLinks: [] }),
      makeArtifact({ id: 'bar', bodyLinks: ['foo'] })
    ]
    const graph = buildGraph(artifacts)
    const relatedEdges = graph.edges.filter((e) => e.kind === 'related')
    expect(relatedEdges).toHaveLength(1)
    expect(relatedEdges[0].source).toBe('bar')
    expect(relatedEdges[0].target).toBe('Foo')
  })

  it('does not create phantom node when case differs', () => {
    const artifacts: Artifact[] = [
      makeArtifact({ id: 'MyNote' }),
      makeArtifact({ id: 'other', bodyLinks: ['mynote'] })
    ]
    const graph = buildGraph(artifacts)
    const nodeIds = graph.nodes.map((n) => n.id)
    expect(nodeIds).not.toContain('mynote')
    expect(nodeIds).toContain('MyNote')
  })

  it('falls back to raw link when no node matches', () => {
    const artifacts: Artifact[] = [makeArtifact({ id: 'a', bodyLinks: ['nonexistent'] })]
    const graph = buildGraph(artifacts)
    const relatedEdges = graph.edges.filter((e) => e.kind === 'related')
    expect(relatedEdges).toHaveLength(1)
    expect(relatedEdges[0].target).toBe('nonexistent')
  })

  it('[[Foo]] and [[foo]] from different artifacts both resolve to same node', () => {
    const artifacts: Artifact[] = [
      makeArtifact({ id: 'Foo' }),
      makeArtifact({ id: 'a', bodyLinks: ['foo'] }),
      makeArtifact({ id: 'b', bodyLinks: ['foo'] })
    ]
    const graph = buildGraph(artifacts)
    const relatedEdges = graph.edges.filter((e) => e.kind === 'related')
    expect(relatedEdges).toHaveLength(2)
    for (const edge of relatedEdges) {
      expect(edge.target).toBe('Foo')
    }
  })
})

describe('frontmatter relationship arrays resolve titles to ids', () => {
  // Regression: autocomplete inserts *titles* into frontmatter arrays, but the
  // raw value was used as a node id — producing a phantom node next to the
  // real note whenever id (filename stem) and title differ.
  it('connection by title resolves to the real node, not a phantom', () => {
    const artifacts: Artifact[] = [
      makeArtifact({ id: 'claude-code-playbook', title: 'Claude Code Playbook' }),
      makeArtifact({ id: 'a', connections: ['Claude Code Playbook'] })
    ]
    const graph = buildGraph(artifacts)
    const connections = graph.edges.filter((e) => e.kind === 'connection')
    expect(connections).toHaveLength(1)
    expect(connections[0].source).toBe('a')
    expect(connections[0].target).toBe('claude-code-playbook')
    expect(graph.nodes.map((n) => n.id)).not.toContain('Claude Code Playbook')
  })

  it('resolves all five relationship arrays through the same lookup', () => {
    const artifacts: Artifact[] = [
      makeArtifact({ id: 'target-note', title: 'Target Note' }),
      makeArtifact({
        id: 'a',
        connections: ['Target Note'],
        clusters_with: ['Target Note'],
        tensions_with: ['Target Note'],
        appears_in: ['Target Note'],
        related: ['Target Note']
      })
    ]
    const graph = buildGraph(artifacts)
    for (const kind of ['connection', 'cluster', 'tension', 'appears_in', 'related'] as const) {
      const edge = graph.edges.find((e) => e.kind === kind)
      expect(edge?.target).toBe('target-note')
    }
    expect(graph.nodes.map((n) => n.id)).not.toContain('Target Note')
  })

  it('keys unresolved references by lowercase id with first-seen display casing in title', () => {
    const artifacts: Artifact[] = [makeArtifact({ id: 'a', connections: ['Richard Hamming'] })]
    const graph = buildGraph(artifacts)
    const ghost = graph.nodes.find((n) => n.id === 'richard hamming')
    expect(ghost).toBeDefined()
    expect(ghost?.title).toBe('Richard Hamming')
    expect(graph.nodes.map((n) => n.id)).not.toContain('Richard Hamming')
  })

  it('converges case-split frontmatter and body references onto one ghost node', () => {
    const artifacts: Artifact[] = [
      makeArtifact({ id: 'a', connections: ['Richard Hamming'] }),
      makeArtifact({ id: 'b', bodyLinks: ['richard hamming'] })
    ]
    const graph = buildGraph(artifacts)
    const ghosts = graph.nodes.filter((n) => n.id.toLowerCase() === 'richard hamming')
    expect(ghosts).toHaveLength(1)
    expect(ghosts[0].id).toBe('richard hamming')
    expect(ghosts[0].title).toBe('Richard Hamming')
  })

  it('resolves sources to derived_from edges with ghost fallback', () => {
    const artifacts: Artifact[] = [
      makeArtifact({ id: 'source-note', title: 'Source Note' }),
      makeArtifact({ id: 'a', sources: ['Source Note', 'Missing Book'] })
    ]
    const graph = buildGraph(artifacts)
    const derived = graph.edges.filter((e) => e.kind === 'derived_from')
    expect(derived.map((e) => e.target).sort()).toEqual(['missing book', 'source-note'])
    expect(graph.nodes.find((n) => n.id === 'missing book')?.title).toBe('Missing Book')
  })
})
