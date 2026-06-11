import { describe, it, expect, beforeEach } from 'vitest'
import { useVaultStore } from '@renderer/store/vault-store'
import type { Artifact, KnowledgeGraph } from '@shared/types'
import type { WorkerResult } from '@shared/engine/types'

function makeArtifact(id: string, overrides: Partial<Artifact> = {}): Artifact {
  return {
    id,
    title: id,
    type: 'note',
    signal: 'untested',
    tags: [],
    connections: [],
    clusters_with: [],
    tensions_with: [],
    appears_in: [],
    related: [],
    concepts: [],
    origin: 'human',
    sources: [],
    bodyLinks: [],
    body: '',
    frontmatter: {},
    ...overrides
  }
}

/**
 * Graph fixture:
 *   a --connection--> b   (a links to b)
 *   c --connection--> b   (c links to b)
 *   b --connection--> d   (b links to d)
 *   b --appears_in--> e   (structural, excluded from outgoing)
 *   ghost: a --connection--> phantom idea (no artifact)
 */
function makeGraph(): KnowledgeGraph {
  return {
    nodes: [
      {
        id: 'a',
        title: 'A',
        type: 'note',
        signal: 'untested',
        connectionCount: 2,
        origin: 'human'
      },
      {
        id: 'b',
        title: 'B',
        type: 'note',
        signal: 'untested',
        connectionCount: 4,
        origin: 'human'
      },
      {
        id: 'c',
        title: 'C',
        type: 'note',
        signal: 'untested',
        connectionCount: 1,
        origin: 'human'
      },
      {
        id: 'd',
        title: 'D',
        type: 'note',
        signal: 'untested',
        connectionCount: 1,
        origin: 'human'
      },
      {
        id: 'e',
        title: 'E',
        type: 'note',
        signal: 'untested',
        connectionCount: 1,
        origin: 'human'
      },
      {
        id: 'phantom idea',
        title: 'phantom idea',
        type: 'note',
        signal: 'untested',
        connectionCount: 1
      }
    ],
    edges: [
      { source: 'a', target: 'b', kind: 'connection' },
      { source: 'c', target: 'b', kind: 'connection' },
      { source: 'b', target: 'd', kind: 'connection' },
      { source: 'b', target: 'e', kind: 'appears_in' },
      { source: 'a', target: 'phantom idea', kind: 'connection' }
    ]
  }
}

function makeWorkerResult(): WorkerResult {
  const artifacts = ['a', 'b', 'c', 'd', 'e'].map((id) =>
    makeArtifact(id, { body: id === 'a' ? 'mentions [[phantom idea]] here' : '' })
  )
  return {
    artifacts,
    graph: makeGraph(),
    errors: [],
    fileToId: Object.fromEntries(artifacts.map((a) => [`/vault/${a.id}.md`, a.id])),
    artifactPathById: Object.fromEntries(artifacts.map((a) => [a.id, `/vault/${a.id}.md`]))
  }
}

describe('vault-store link queries', () => {
  beforeEach(() => {
    useVaultStore.setState(useVaultStore.getInitialState())
    useVaultStore.getState().setWorkerResult(makeWorkerResult())
  })

  it('getBacklinks returns only inbound links (artifacts that link TO the target)', () => {
    const backlinks = useVaultStore.getState().getBacklinks('b')
    const ids = backlinks.map((a) => a.id).sort()

    // a and c link to b; d is an OUTGOING link from b and must not appear
    expect(ids).toEqual(['a', 'c'])
  })

  it('getOutgoingLinks returns artifacts the source links to, excluding appears_in', () => {
    const outgoing = useVaultStore.getState().getOutgoingLinks('b')
    const ids = outgoing.map((a) => a.id).sort()

    // b links to d (connection); e is appears_in (structural) and excluded
    expect(ids).toEqual(['d'])
  })

  it('inbound and outgoing are disjoint views of the same edges', () => {
    const inbound = useVaultStore.getState().getBacklinks('b')
    const outgoing = useVaultStore.getState().getOutgoingLinks('b')
    const overlap = inbound.filter((a) => outgoing.some((o) => o.id === a.id))

    expect(overlap).toEqual([])
  })

  it('matches case-insensitively', () => {
    const backlinks = useVaultStore.getState().getBacklinks('B')
    expect(backlinks.map((a) => a.id).sort()).toEqual(['a', 'c'])
  })
})

describe('vault-store unlinked mentions', () => {
  beforeEach(() => {
    useVaultStore.setState(useVaultStore.getInitialState())
    useVaultStore.setState({
      artifacts: [
        makeArtifact('target', { title: 'Spaced Repetition' }),
        makeArtifact('plain', { body: 'I read about spaced repetition today.' }),
        makeArtifact('linked', { body: 'See [[Spaced Repetition]] for the method.' }),
        makeArtifact('by-id', { body: 'The target note covers this.' })
      ],
      artifactById: {
        target: makeArtifact('target', { title: 'Spaced Repetition' })
      }
    })
  })

  it('returns artifacts with unlinked title/id mentions, excluding self and linked-only', () => {
    const mentions = useVaultStore.getState().getUnlinkedMentions('target', 'Spaced Repetition')
    const ids = mentions.map((m) => m.artifact.id).sort()

    // 'plain' mentions the title; 'by-id' mentions the id; 'linked' only links
    expect(ids).toEqual(['by-id', 'plain'])
    const plain = mentions.find((m) => m.artifact.id === 'plain')
    expect(plain?.matches).toHaveLength(1)
  })

  it('falls back to the target artifact title when none is passed', () => {
    const mentions = useVaultStore.getState().getUnlinkedMentions('target')
    expect(mentions.map((m) => m.artifact.id).sort()).toEqual(['by-id', 'plain'])
  })
})

describe('vault-store ghost index memoization', () => {
  beforeEach(() => {
    useVaultStore.setState(useVaultStore.getInitialState())
  })

  it('setWorkerResult populates ghostIndex once per result', () => {
    expect(useVaultStore.getState().ghostIndex).toEqual([])

    useVaultStore.getState().setWorkerResult(makeWorkerResult())

    const index = useVaultStore.getState().ghostIndex
    expect(index.map((g) => g.id)).toContain('phantom idea')

    // Stable reference between reads — panels share the memoized result
    expect(useVaultStore.getState().ghostIndex).toBe(index)
  })
})
