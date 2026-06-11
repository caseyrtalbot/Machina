import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createWorkerHelpers,
  createWorkerController,
  APPEND_POST_INTERVAL_MS
} from '../vault-worker-helpers'
import type { WorkerOutMessage } from '../vault-worker-helpers'

vi.mock('../parser', () => ({
  parseArtifact: vi.fn((content: string, path: string) => {
    if (content === 'INVALID') return { ok: false, error: `Parse error in ${path}` }
    return { ok: true, value: { id: `id-${path}`, title: path, modified: '2026-01-01' } }
  })
}))

vi.mock('../graph-builder', () => ({
  buildGraph: vi.fn((artifacts: Record<string, unknown>[]) => ({
    nodes: artifacts.map((a: Record<string, unknown>) => ({ id: a.id })),
    edges: []
  }))
}))

describe('vault-worker helpers', () => {
  let helpers: ReturnType<typeof createWorkerHelpers>
  beforeEach(() => {
    helpers = createWorkerHelpers()
  })

  it('addFile stores artifact on successful parse', () => {
    helpers.addFile('test.md', '# Hello')
    const result = helpers.buildResult()
    expect(result.artifacts).toHaveLength(1)
    expect(result.errors).toHaveLength(0)
    expect(result.artifactPathById['id-test.md']).toBe('test.md')
  })

  it('addFile records error on failed parse', () => {
    helpers.addFile('bad.md', 'INVALID')
    const result = helpers.buildResult()
    expect(result.artifacts).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].filename).toBe('bad.md')
  })

  it('addFile clears stale errors for same path before re-parsing', () => {
    helpers.addFile('test.md', 'INVALID')
    helpers.addFile('test.md', '# Valid')
    const result = helpers.buildResult()
    expect(result.errors).toHaveLength(0)
    expect(result.artifacts).toHaveLength(1)
  })

  it('removeFile clears both artifact and errors for a path', () => {
    helpers.addFile('test.md', 'INVALID')
    helpers.removeFile('test.md')
    const result = helpers.buildResult()
    expect(result.artifacts).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
  })

  it('update scenario: removeFile then addFile replaces artifact', () => {
    helpers.addFile('test.md', '# V1')
    helpers.removeFile('test.md')
    helpers.addFile('test.md', '# V2')
    const result = helpers.buildResult()
    expect(result.artifacts).toHaveLength(1)
  })
})

describe('vault-worker controller', () => {
  let posts: WorkerOutMessage[]
  let controller: ReturnType<typeof createWorkerController>

  beforeEach(() => {
    vi.useFakeTimers()
    posts = []
    // This suite only sends load/append/update-many, so every post is a
    // WorkerOutMessage; search round-trips live in tests/engine/vault-worker-search.test.ts.
    controller = createWorkerController((msg) => posts.push(msg as WorkerOutMessage))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('load rebuilds and posts immediately', () => {
    controller.handleMessage({ type: 'load', files: [{ path: 'a.md', content: '# A' }] })
    expect(posts).toHaveLength(1)
    expect(posts[0].type).toBe('loaded')
    expect(posts[0].artifacts).toHaveLength(1)
  })

  it('throttles append posts to one per interval with a final trailing post', () => {
    controller.handleMessage({ type: 'load', files: [{ path: 'a.md', content: '# A' }] })
    expect(posts).toHaveLength(1)

    // Many appends inside the interval: no immediate posts, one trailing post
    controller.handleMessage({ type: 'append', files: [{ path: 'b.md', content: '# B' }] })
    controller.handleMessage({ type: 'append', files: [{ path: 'c.md', content: '# C' }] })
    controller.handleMessage({ type: 'append', files: [{ path: 'd.md', content: '# D' }] })
    expect(posts).toHaveLength(1)

    vi.advanceTimersByTime(APPEND_POST_INTERVAL_MS)
    expect(posts).toHaveLength(2)
    expect(posts[1].type).toBe('loaded')
    // The trailing post includes every appended file, not just the first
    expect(posts[1].artifacts).toHaveLength(4)
  })

  it('append after the interval has elapsed posts immediately', () => {
    controller.handleMessage({ type: 'load', files: [] })
    vi.advanceTimersByTime(APPEND_POST_INTERVAL_MS)
    controller.handleMessage({ type: 'append', files: [{ path: 'b.md', content: '# B' }] })
    expect(posts).toHaveLength(2)
  })

  it('update-many applies removes and updates in one rebuild', () => {
    controller.handleMessage({
      type: 'load',
      files: [
        { path: 'a.md', content: '# A' },
        { path: 'b.md', content: '# B' }
      ]
    })
    posts.length = 0

    controller.handleMessage({
      type: 'update-many',
      updates: [
        { path: 'a.md', content: '# A2' },
        { path: 'c.md', content: '# C' }
      ],
      removes: ['b.md']
    })

    expect(posts).toHaveLength(1)
    expect(posts[0].type).toBe('updated')
    const paths = Object.keys(posts[0].fileToId).sort()
    expect(paths).toEqual(['a.md', 'c.md'])
  })

  it('update-many cancels a pending append timer instead of double-posting', () => {
    controller.handleMessage({ type: 'load', files: [] })
    controller.handleMessage({ type: 'append', files: [{ path: 'b.md', content: '# B' }] })
    posts.length = 0

    controller.handleMessage({ type: 'update-many', updates: [], removes: ['b.md'] })
    expect(posts).toHaveLength(1)
    expect(posts[0].type).toBe('updated')

    vi.advanceTimersByTime(APPEND_POST_INTERVAL_MS * 2)
    expect(posts).toHaveLength(1)
  })
})
