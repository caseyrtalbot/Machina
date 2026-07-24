import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createWorkerHelpers,
  createWorkerController,
  APPEND_POST_INTERVAL_MS
} from '../vault-worker-helpers'
import type { WorkerOutMessage } from '../vault-worker-helpers'
import type { Artifact } from '@shared/types'
import type { VaultIndexEntry } from '@shared/index-delta'

// The worker no longer parses markdown — main's VaultIndex is the single parse
// authority and hands the worker pre-parsed entries. Only the graph rebuild
// stays worker-side, so buildGraph is the only mock.
vi.mock('../graph-builder', () => ({
  buildGraph: vi.fn((artifacts: Record<string, unknown>[]) => ({
    nodes: artifacts.map((a: Record<string, unknown>) => ({ id: a.id })),
    edges: []
  }))
}))

function artifact(id: string, overrides: Partial<Artifact> = {}): Artifact {
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

function entry(path: string, id: string, overrides: Partial<Artifact> = {}): VaultIndexEntry {
  return { path, artifact: artifact(id, overrides), error: null }
}

function errorEntry(path: string, message: string): VaultIndexEntry {
  return { path, artifact: null, error: { filename: path, error: message } }
}

describe('vault-worker helpers', () => {
  let helpers: ReturnType<typeof createWorkerHelpers>
  beforeEach(() => {
    helpers = createWorkerHelpers()
  })

  it('ingestEntry stores the artifact for an artifact-bearing entry', () => {
    helpers.ingestEntry(entry('test.md', 'id-test'))
    const result = helpers.buildResult()
    expect(result.artifacts).toHaveLength(1)
    expect(result.errors).toHaveLength(0)
    expect(result.artifactPathById['id-test']).toBe('test.md')
    expect(result.fileToId['test.md']).toBe('id-test')
  })

  it('ingestEntry records the error for an artifact-null entry', () => {
    helpers.ingestEntry(errorEntry('bad.md', 'boom'))
    const result = helpers.buildResult()
    expect(result.artifacts).toHaveLength(0)
    expect(result.errors).toEqual([{ filename: 'bad.md', error: 'boom' }])
  })

  it('an artifact-null entry drops a prior artifact for the same path', () => {
    helpers.ingestEntry(entry('test.md', 'id-test'))
    helpers.ingestEntry(errorEntry('test.md', 'boom'))
    const result = helpers.buildResult()
    expect(result.artifacts).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
  })

  it('a later good entry clears a prior error for the same path', () => {
    helpers.ingestEntry(errorEntry('test.md', 'boom'))
    helpers.ingestEntry(entry('test.md', 'id-test'))
    const result = helpers.buildResult()
    expect(result.errors).toHaveLength(0)
    expect(result.artifacts).toHaveLength(1)
  })

  it('ingestEntry replaces the artifact for a path, dropping a changed id', () => {
    helpers.ingestEntry(entry('test.md', 'id-1'))
    helpers.ingestEntry(entry('test.md', 'id-2'))
    const result = helpers.buildResult()
    expect(result.artifacts).toHaveLength(1)
    expect(result.artifactPathById['id-2']).toBe('test.md')
    expect(result.artifactPathById['id-1']).toBeUndefined()
  })

  it('removeFile clears both artifact and errors for a path', () => {
    helpers.ingestEntry(errorEntry('test.md', 'boom'))
    helpers.removeFile('test.md')
    let result = helpers.buildResult()
    expect(result.errors).toHaveLength(0)

    helpers.ingestEntry(entry('test.md', 'id-test'))
    helpers.removeFile('test.md')
    result = helpers.buildResult()
    expect(result.artifacts).toHaveLength(0)
  })
})

describe('vault-worker controller', () => {
  let posts: WorkerOutMessage[]
  let controller: ReturnType<typeof createWorkerController>

  beforeEach(() => {
    vi.useFakeTimers()
    posts = []
    // This suite only sends load/append/apply-delta, so every post is a
    // WorkerOutMessage; search round-trips live in tests/engine/vault-worker-search.test.ts.
    controller = createWorkerController((msg) => posts.push(msg as WorkerOutMessage))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('load rebuilds and posts immediately', () => {
    controller.handleMessage({ type: 'load', entries: [entry('a.md', 'a')] })
    expect(posts).toHaveLength(1)
    expect(posts[0].type).toBe('loaded')
    expect(posts[0].artifacts).toHaveLength(1)
  })

  it('throttles append posts to one per interval with a final trailing post', () => {
    controller.handleMessage({ type: 'load', entries: [entry('a.md', 'a')] })
    expect(posts).toHaveLength(1)

    // Many appends inside the interval: no immediate posts, one trailing post
    controller.handleMessage({ type: 'append', entries: [entry('b.md', 'b')] })
    controller.handleMessage({ type: 'append', entries: [entry('c.md', 'c')] })
    controller.handleMessage({ type: 'append', entries: [entry('d.md', 'd')] })
    expect(posts).toHaveLength(1)

    vi.advanceTimersByTime(APPEND_POST_INTERVAL_MS)
    expect(posts).toHaveLength(2)
    expect(posts[1].type).toBe('loaded')
    // The trailing post includes every appended entry, not just the first
    expect(posts[1].artifacts).toHaveLength(4)
  })

  it('append after the interval has elapsed posts immediately', () => {
    controller.handleMessage({ type: 'load', entries: [] })
    vi.advanceTimersByTime(APPEND_POST_INTERVAL_MS)
    controller.handleMessage({ type: 'append', entries: [entry('b.md', 'b')] })
    expect(posts).toHaveLength(2)
  })

  it('apply-delta applies removes and upserts in one rebuild', () => {
    controller.handleMessage({
      type: 'load',
      entries: [entry('a.md', 'id-a'), entry('b.md', 'id-b')]
    })
    posts.length = 0

    controller.handleMessage({
      type: 'apply-delta',
      upserts: [entry('a.md', 'id-a2'), entry('c.md', 'id-c')],
      removes: ['b.md']
    })

    expect(posts).toHaveLength(1)
    expect(posts[0].type).toBe('updated')
    const paths = Object.keys(posts[0].fileToId).sort()
    expect(paths).toEqual(['a.md', 'c.md'])
  })

  it('apply-delta is idempotent on replay: an upsert replaces by path', () => {
    controller.handleMessage({ type: 'load', entries: [entry('a.md', 'id-a')] })
    posts.length = 0

    controller.handleMessage({ type: 'apply-delta', upserts: [entry('a.md', 'id-a')], removes: [] })
    controller.handleMessage({ type: 'apply-delta', upserts: [entry('a.md', 'id-a')], removes: [] })

    expect(posts[posts.length - 1].artifacts).toHaveLength(1)
  })

  it('apply-delta with an artifact-null upsert drops the artifact then a good one restores it', () => {
    controller.handleMessage({ type: 'load', entries: [entry('a.md', 'id-a')] })
    posts.length = 0

    controller.handleMessage({
      type: 'apply-delta',
      upserts: [errorEntry('a.md', 'boom')],
      removes: []
    })
    expect(posts[0].artifacts).toHaveLength(0)
    expect(posts[0].errors).toHaveLength(1)

    controller.handleMessage({ type: 'apply-delta', upserts: [entry('a.md', 'id-a')], removes: [] })
    expect(posts[1].artifacts).toHaveLength(1)
    expect(posts[1].errors).toHaveLength(0)
  })

  it('apply-delta cancels a pending append timer instead of double-posting', () => {
    controller.handleMessage({ type: 'load', entries: [] })
    controller.handleMessage({ type: 'append', entries: [entry('b.md', 'b')] })
    posts.length = 0

    controller.handleMessage({ type: 'apply-delta', upserts: [], removes: ['b.md'] })
    expect(posts).toHaveLength(1)
    expect(posts[0].type).toBe('updated')

    vi.advanceTimersByTime(APPEND_POST_INTERVAL_MS * 2)
    expect(posts).toHaveLength(1)
  })
})
