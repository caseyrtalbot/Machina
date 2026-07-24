import { describe, it, expect, beforeEach } from 'vitest'
import { createWorkerController } from '@engine/vault-worker-helpers'
import type {
  WorkerInMessage,
  WorkerMessage,
  WorkerSearchResponse
} from '@engine/vault-worker-helpers'
import type { Artifact } from '@shared/types'
import type { VaultIndexEntry } from '@shared/index-delta'

// Real SearchEngine, entry-fed: this is the worker-side round-trip for human
// full-text search (3.1). Parsing now lives in main (one parse authority), so
// the worker ingests pre-parsed entries rather than markdown content.

function entry(path: string, id: string, title: string, body: string): VaultIndexEntry {
  const artifact: Artifact = {
    id,
    title,
    type: 'note',
    created: '2026-06-01',
    modified: '2026-06-01',
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
    body,
    frontmatter: {}
  }
  return { path, artifact, error: null }
}

const ALPHA_BODY =
  'A long exploration of ideas. The phrase quantum entanglement appears deep in the body, surrounded by context words on either side of the match.'

function isSearchResponse(msg: WorkerMessage): msg is WorkerSearchResponse {
  return msg.type === 'search-results'
}

describe('vault-worker full-text search round-trip', () => {
  let posts: WorkerMessage[]
  let handleMessage: (msg: WorkerInMessage) => void

  beforeEach(() => {
    posts = []
    const controller = createWorkerController((msg) => posts.push(msg), 0)
    handleMessage = controller.handleMessage
    handleMessage({
      type: 'load',
      entries: [
        entry('/v/alpha.md', 'alpha', 'Alpha Note', ALPHA_BODY),
        entry('/v/beta.md', 'beta', 'Beta Note', 'Nothing relevant here.')
      ]
    })
    posts = []
  })

  it('answers a search message with hits carrying the requestId and a context snippet', () => {
    handleMessage({ type: 'search', requestId: 7, query: 'entanglement' })

    expect(posts).toHaveLength(1)
    const res = posts[0]
    expect(isSearchResponse(res)).toBe(true)
    if (!isSearchResponse(res)) return
    expect(res.requestId).toBe(7)
    expect(res.hits).toHaveLength(1)
    expect(res.hits[0].path).toBe('/v/alpha.md')
    expect(res.hits[0].title).toBe('Alpha Note')
    // Snippet shows surrounding context, not just the bare term.
    expect(res.hits[0].snippet).toContain('quantum entanglement')
    expect(res.hits[0].snippet).toContain('phrase')
    expect(res.hits[0].snippet).toContain('deep in the body')
  })

  it('does not trigger a graph rebuild post for a search message', () => {
    handleMessage({ type: 'search', requestId: 1, query: 'entanglement' })
    expect(posts.map((p) => p.type)).toEqual(['search-results'])
  })

  it('reflects apply-delta edits: new body terms found, stale terms gone', () => {
    handleMessage({
      type: 'apply-delta',
      upserts: [entry('/v/alpha.md', 'alpha', 'Alpha Note', 'Now about gravity wells only.')],
      removes: []
    })
    posts = []

    handleMessage({ type: 'search', requestId: 2, query: 'entanglement' })
    handleMessage({ type: 'search', requestId: 3, query: 'gravity' })

    const [stale, fresh] = posts.filter(isSearchResponse)
    expect(stale.requestId).toBe(2)
    expect(stale.hits).toHaveLength(0)
    expect(fresh.requestId).toBe(3)
    expect(fresh.hits.map((h) => h.path)).toEqual(['/v/alpha.md'])
  })

  it('drops removed files from the index', () => {
    handleMessage({ type: 'apply-delta', upserts: [], removes: ['/v/alpha.md'] })
    posts = []

    handleMessage({ type: 'search', requestId: 4, query: 'entanglement' })
    const res = posts.filter(isSearchResponse)[0]
    expect(res.hits).toHaveLength(0)
  })

  it('returns no hits for a blank query', () => {
    handleMessage({ type: 'search', requestId: 5, query: '   ' })
    const res = posts.filter(isSearchResponse)[0]
    expect(res.requestId).toBe(5)
    expect(res.hits).toHaveLength(0)
  })
})
