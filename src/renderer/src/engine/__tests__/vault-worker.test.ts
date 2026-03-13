import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createWorkerHelpers } from '../vault-worker-helpers'

vi.mock('../parser', () => ({
  parseArtifact: vi.fn((content: string, path: string) => {
    if (content === 'INVALID') return { ok: false, error: `Parse error in ${path}` }
    return { ok: true, value: { id: `id-${path}`, title: path, modified: '2026-01-01' } }
  }),
}))

vi.mock('../graph-builder', () => ({
  buildGraph: vi.fn((artifacts: any[]) => ({ nodes: artifacts.map((a: any) => ({ id: a.id })), edges: [] })),
}))

describe('vault-worker helpers', () => {
  let helpers: ReturnType<typeof createWorkerHelpers>
  beforeEach(() => { helpers = createWorkerHelpers() })

  it('addFile stores artifact on successful parse', () => {
    helpers.addFile('test.md', '# Hello')
    const result = helpers.buildResult()
    expect(result.artifacts).toHaveLength(1)
    expect(result.errors).toHaveLength(0)
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
