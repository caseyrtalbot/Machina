import { describe, it, expect } from 'vitest'
import { computeDerivedHealth } from '@shared/engine/vault-health'
import type { WorkerResult } from '@shared/engine/types'
import type { Artifact } from '@shared/types'

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

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
    concepts: [],
    origin: 'human',
    sources: [],
    bodyLinks: [],
    body: '',
    frontmatter: {},
    ...overrides
  }
}

function makeWorkerResult(overrides: Partial<WorkerResult> = {}): WorkerResult {
  return {
    artifacts: [],
    graph: { nodes: [], edges: [] },
    errors: [],
    fileToId: {},
    artifactPathById: {},
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// parse-errors check
// ---------------------------------------------------------------------------

describe('parse-errors check', () => {
  it('passes when workerResult.errors is empty', () => {
    const result = computeDerivedHealth({
      workerResult: makeWorkerResult(),
      files: []
    })
    const run = result.runs.find((r) => r.checkId === 'parse-errors')
    expect(run).toBeDefined()
    expect(run!.passed).toBe(true)
    expect(run!.issues).toHaveLength(0)
  })

  it('reports each parse error as a hard issue', () => {
    const wr = makeWorkerResult({
      errors: [
        { filename: 'notes/a.md', error: 'Invalid YAML at line 3' },
        { filename: 'notes/b.md', error: 'Missing frontmatter' }
      ]
    })
    const result = computeDerivedHealth({ workerResult: wr, files: [] })
    const run = result.runs.find((r) => r.checkId === 'parse-errors')!
    expect(run.passed).toBe(false)
    expect(run.issues).toHaveLength(2)
    expect(run.issues[0]).toEqual({
      checkId: 'parse-errors',
      severity: 'hard',
      title: 'Parse error',
      detail: 'Invalid YAML at line 3',
      filePath: 'notes/a.md'
    })
    expect(run.issues[1]).toEqual({
      checkId: 'parse-errors',
      severity: 'hard',
      title: 'Parse error',
      detail: 'Missing frontmatter',
      filePath: 'notes/b.md'
    })
  })

  it('wraps thrown error as synthetic hard issue', () => {
    const wr = makeWorkerResult({
      errors: null as unknown as WorkerResult['errors']
    })
    const result = computeDerivedHealth({ workerResult: wr, files: [] })
    const run = result.runs.find((r) => r.checkId === 'parse-errors')!
    expect(run.passed).toBe(false)
    expect(run.issues).toHaveLength(1)
    expect(run.issues[0].severity).toBe('hard')
    expect(run.issues[0].title).toBe('Health check crashed')
  })
})

// ---------------------------------------------------------------------------
// broken-refs check
// ---------------------------------------------------------------------------

describe('broken-refs check', () => {
  it('passes when all frontmatter refs resolve', () => {
    const wr = makeWorkerResult({
      artifacts: [
        makeArtifact({ id: 'note-1', connections: ['note-2'] }),
        makeArtifact({ id: 'note-2', connections: ['note-1'] })
      ],
      fileToId: { 'notes/1.md': 'note-1', 'notes/2.md': 'note-2' },
      artifactPathById: { 'note-1': 'notes/1.md', 'note-2': 'notes/2.md' }
    })
    const result = computeDerivedHealth({ workerResult: wr, files: [] })
    const run = result.runs.find((r) => r.checkId === 'broken-refs')!
    expect(run.passed).toBe(true)
    expect(run.issues).toHaveLength(0)
  })

  it('reports unresolved ref as integrity issue', () => {
    const wr = makeWorkerResult({
      artifacts: [makeArtifact({ id: 'note-1', connections: ['ghost-ref'] })],
      fileToId: { 'notes/1.md': 'note-1' },
      artifactPathById: { 'note-1': 'notes/1.md' }
    })
    const result = computeDerivedHealth({ workerResult: wr, files: [] })
    const run = result.runs.find((r) => r.checkId === 'broken-refs')!
    expect(run.passed).toBe(false)
    expect(run.issues).toHaveLength(1)
    expect(run.issues[0]).toEqual({
      checkId: 'broken-refs',
      severity: 'integrity',
      title: 'Broken reference',
      detail: 'note-1 references ghost-ref which does not exist',
      filePath: 'notes/1.md'
    })
  })

  it('skips artifacts that have parse errors', () => {
    const wr = makeWorkerResult({
      artifacts: [makeArtifact({ id: 'note-1', connections: ['ghost-ref'] })],
      errors: [{ filename: 'notes/1.md', error: 'bad yaml' }],
      fileToId: { 'notes/1.md': 'note-1' },
      artifactPathById: { 'note-1': 'notes/1.md' }
    })
    const result = computeDerivedHealth({ workerResult: wr, files: [] })
    const run = result.runs.find((r) => r.checkId === 'broken-refs')!
    expect(run.passed).toBe(true)
    expect(run.issues).toHaveLength(0)
  })

  it('checks all five relationship arrays', () => {
    const wr = makeWorkerResult({
      artifacts: [
        makeArtifact({
          id: 'note-1',
          connections: ['missing-conn'],
          clusters_with: ['missing-cluster'],
          tensions_with: ['missing-tension'],
          appears_in: ['missing-appears'],
          related: ['missing-related']
        })
      ],
      fileToId: { 'notes/1.md': 'note-1' },
      artifactPathById: { 'note-1': 'notes/1.md' }
    })
    const result = computeDerivedHealth({ workerResult: wr, files: [] })
    const run = result.runs.find((r) => r.checkId === 'broken-refs')!
    expect(run.passed).toBe(false)
    expect(run.issues).toHaveLength(5)
    const details = run.issues.map((i) => i.detail)
    expect(details).toContain('note-1 references missing-conn which does not exist')
    expect(details).toContain('note-1 references missing-cluster which does not exist')
    expect(details).toContain('note-1 references missing-tension which does not exist')
    expect(details).toContain('note-1 references missing-appears which does not exist')
    expect(details).toContain('note-1 references missing-related which does not exist')
  })
})

// ---------------------------------------------------------------------------
// stale-worker-index check
// ---------------------------------------------------------------------------

describe('stale-worker-index check', () => {
  it('passes when file paths match fileToId keys', () => {
    const wr = makeWorkerResult({
      fileToId: { 'notes/a.md': 'a', 'notes/b.md': 'b' }
    })
    const files = [
      { path: 'notes/a.md', filename: 'a.md' },
      { path: 'notes/b.md', filename: 'b.md' }
    ]
    const result = computeDerivedHealth({ workerResult: wr, files })
    const run = result.runs.find((r) => r.checkId === 'stale-worker-index')!
    expect(run.passed).toBe(true)
    expect(run.issues).toHaveLength(0)
  })

  it('reports files on disk not in worker index', () => {
    const wr = makeWorkerResult({
      fileToId: { 'notes/a.md': 'a' }
    })
    const files = [
      { path: 'notes/a.md', filename: 'a.md' },
      { path: 'notes/new.md', filename: 'new.md' }
    ]
    const result = computeDerivedHealth({ workerResult: wr, files })
    const run = result.runs.find((r) => r.checkId === 'stale-worker-index')!
    expect(run.passed).toBe(false)
    expect(run.issues).toHaveLength(1)
    expect(run.issues[0].detail).toContain('notes/new.md')
  })

  it('reports worker entries with no source file', () => {
    const wr = makeWorkerResult({
      fileToId: { 'notes/a.md': 'a', 'notes/deleted.md': 'deleted' }
    })
    const files = [{ path: 'notes/a.md', filename: 'a.md' }]
    const result = computeDerivedHealth({ workerResult: wr, files })
    const run = result.runs.find((r) => r.checkId === 'stale-worker-index')!
    expect(run.passed).toBe(false)
    expect(run.issues).toHaveLength(1)
    expect(run.issues[0].detail).toContain('notes/deleted.md')
  })

  it('excludes parse-error files from comparison', () => {
    const wr = makeWorkerResult({
      fileToId: { 'notes/a.md': 'a' },
      errors: [{ filename: 'notes/broken.md', error: 'bad' }]
    })
    const files = [
      { path: 'notes/a.md', filename: 'a.md' },
      { path: 'notes/broken.md', filename: 'broken.md' }
    ]
    const result = computeDerivedHealth({ workerResult: wr, files })
    const run = result.runs.find((r) => r.checkId === 'stale-worker-index')!
    expect(run.passed).toBe(true)
    expect(run.issues).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// computeDerivedHealth aggregation
// ---------------------------------------------------------------------------

describe('computeDerivedHealth aggregation', () => {
  it('returns all three check runs', () => {
    const result = computeDerivedHealth({
      workerResult: makeWorkerResult(),
      files: []
    })
    const ids = result.runs.map((r) => r.checkId)
    expect(ids).toContain('parse-errors')
    expect(ids).toContain('broken-refs')
    expect(ids).toContain('stale-worker-index')
    expect(result.runs).toHaveLength(3)
  })

  it('sets computedAt to a recent timestamp', () => {
    const before = Date.now()
    const result = computeDerivedHealth({
      workerResult: makeWorkerResult(),
      files: []
    })
    const after = Date.now()
    expect(result.computedAt).toBeGreaterThanOrEqual(before)
    expect(result.computedAt).toBeLessThanOrEqual(after)
  })

  it('all passing input yields all runs passed', () => {
    const wr = makeWorkerResult({
      artifacts: [makeArtifact({ id: 'a', connections: ['b'] }), makeArtifact({ id: 'b' })],
      fileToId: { 'a.md': 'a', 'b.md': 'b' },
      artifactPathById: { a: 'a.md', b: 'b.md' }
    })
    const files = [
      { path: 'a.md', filename: 'a.md' },
      { path: 'b.md', filename: 'b.md' }
    ]
    const result = computeDerivedHealth({ workerResult: wr, files })
    expect(result.runs.every((r) => r.passed)).toBe(true)
  })

  it('mixed failures produces correct run set', () => {
    const wr = makeWorkerResult({
      artifacts: [makeArtifact({ id: 'a', connections: ['ghost'] })],
      errors: [{ filename: 'broken.md', error: 'bad' }],
      fileToId: { 'a.md': 'a' },
      artifactPathById: { a: 'a.md' }
    })
    const result = computeDerivedHealth({ workerResult: wr, files: [] })
    const parseRun = result.runs.find((r) => r.checkId === 'parse-errors')!
    const refsRun = result.runs.find((r) => r.checkId === 'broken-refs')!
    expect(parseRun.passed).toBe(false)
    expect(refsRun.passed).toBe(false)
  })

  it('fully broken WorkerResult produces a report, not a throw', () => {
    const wr = null as unknown as WorkerResult
    expect(() => computeDerivedHealth({ workerResult: wr, files: [] })).not.toThrow()
    const result = computeDerivedHealth({ workerResult: wr, files: [] })
    expect(result.runs).toHaveLength(3)
    expect(result.runs.every((r) => !r.passed)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('vault-health edge cases', () => {
  it('empty vault (zero files) — all derived checks pass trivially', () => {
    const result = computeDerivedHealth({
      workerResult: makeWorkerResult(),
      files: []
    })
    expect(result.runs.every((r) => r.passed)).toBe(true)
    expect(result.runs.flatMap((r) => r.issues)).toHaveLength(0)
  })

  it('file with parse error does not also produce broken-refs issue', () => {
    // note-1 refs note-2, note-2 has a parse error but also exists as artifact
    const wr = makeWorkerResult({
      artifacts: [
        makeArtifact({ id: 'note-1', connections: ['note-2'] }),
        makeArtifact({ id: 'note-2' })
      ],
      errors: [{ filename: 'notes/2.md', error: 'bad yaml' }],
      fileToId: { 'notes/1.md': 'note-1', 'notes/2.md': 'note-2' },
      artifactPathById: { 'note-1': 'notes/1.md', 'note-2': 'notes/2.md' }
    })
    const result = computeDerivedHealth({ workerResult: wr, files: [] })
    const refsRun = result.runs.find((r) => r.checkId === 'broken-refs')!
    // note-2 exists as an artifact so the reference resolves
    // note-1 is not in parse-error set so it gets checked
    // connections: ['note-2'] resolves because note-2 is in the valid ID set
    expect(refsRun.issues).toHaveLength(0)
  })

  it('10k-artifact vault completes without quadratic blowup', () => {
    const artifacts: Artifact[] = []
    const fileToId: Record<string, string> = {}
    const artifactPathById: Record<string, string> = {}

    for (let i = 0; i < 10_000; i++) {
      const id = `art-${i}`
      const path = `notes/${id}.md`
      artifacts.push(
        makeArtifact({
          id,
          connections: [`art-${(i + 1) % 10_000}`],
          clusters_with: [`art-${(i + 2) % 10_000}`],
          tensions_with: [`art-${(i + 3) % 10_000}`],
          appears_in: [`art-${(i + 4) % 10_000}`],
          related: [`art-${(i + 5) % 10_000}`]
        })
      )
      fileToId[path] = id
      artifactPathById[id] = path
    }

    const wr = makeWorkerResult({ artifacts, fileToId, artifactPathById })
    const files = artifacts.map((a) => ({
      path: `notes/${a.id}.md`,
      filename: `${a.id}.md`
    }))

    const start = performance.now()
    const result = computeDerivedHealth({ workerResult: wr, files })
    const elapsed = performance.now() - start

    // generous bound: an O(n²) regression takes seconds at 10k; 20ms flaked on loaded machines
    expect(elapsed).toBeLessThan(200)
    expect(result.runs).toHaveLength(3)
    expect(result.runs.every((r) => r.passed)).toBe(true)
  })
})
