import { describe, it, expect } from 'vitest'
import {
  cosineSimilarity,
  topKSimilar,
  parseManifest,
  serializeManifest,
  type EmbeddingManifest
} from '@shared/engine/embeddings'

const vec = (...values: number[]): Float32Array => new Float32Array(values)

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors and -1 for opposite vectors', () => {
    expect(cosineSimilarity(vec(1, 2, 3), vec(1, 2, 3))).toBeCloseTo(1)
    expect(cosineSimilarity(vec(1, 2, 3), vec(-1, -2, -3))).toBeCloseTo(-1)
  })

  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity(vec(1, 0), vec(0, 1))).toBeCloseTo(0)
  })

  it('is scale-invariant', () => {
    expect(cosineSimilarity(vec(1, 1), vec(10, 10))).toBeCloseTo(1)
  })

  it('returns 0 for mismatched lengths, empty, or zero vectors', () => {
    expect(cosineSimilarity(vec(1, 2), vec(1, 2, 3))).toBe(0)
    expect(cosineSimilarity(vec(), vec())).toBe(0)
    expect(cosineSimilarity(vec(0, 0), vec(1, 1))).toBe(0)
  })
})

describe('topKSimilar', () => {
  // Flat store of three 2-d rows: [1,0], [0,1], [0.9, 0.1]
  const store = new Float32Array([1, 0, 0, 1, 0.9, 0.1])

  it('returns indices sorted by descending cosine score', () => {
    const hits = topKSimilar(vec(1, 0), store, 2, 3)
    expect(hits.map((h) => h.index)).toEqual([0, 2, 1])
    expect(hits[0].score).toBeCloseTo(1)
    expect(hits[2].score).toBeCloseTo(0)
  })

  it('caps results at k', () => {
    expect(topKSimilar(vec(1, 0), store, 2, 1)).toHaveLength(1)
  })

  it('returns [] for invalid k, dim, or query dimension mismatch', () => {
    expect(topKSimilar(vec(1, 0), store, 2, 0)).toEqual([])
    expect(topKSimilar(vec(1, 0), store, 0, 3)).toEqual([])
    expect(topKSimilar(vec(1, 0, 0), store, 2, 3)).toEqual([])
  })
})

describe('manifest round-trip', () => {
  const manifest: EmbeddingManifest = {
    version: 1,
    modelId: 'Xenova/all-MiniLM-L6-v2',
    dim: 384,
    vectorsSha256: 'a'.repeat(64),
    entries: [
      { id: 'note-1', path: '/v/a.md', title: 'A', hash: 'h1' },
      { id: 'pdf:/v/b.pdf#p2', path: '/v/b.pdf', title: 'b.pdf', hash: 'h2', page: 2 }
    ]
  }

  it('serialize → parse preserves the manifest, including optional page', () => {
    const parsed = parseManifest(serializeManifest(manifest))
    expect(parsed).toEqual({ ok: true, value: manifest })
  })

  it('rejects invalid JSON', () => {
    expect(parseManifest('{not json').ok).toBe(false)
  })

  it('rejects wrong version, missing fields, and malformed entries', () => {
    expect(parseManifest(JSON.stringify({ ...manifest, version: 2 })).ok).toBe(false)
    expect(parseManifest(JSON.stringify({ version: 1, dim: 384, entries: [] })).ok).toBe(false)
    expect(parseManifest(JSON.stringify({ ...manifest, dim: 'x' })).ok).toBe(false)
    expect(parseManifest(JSON.stringify({ ...manifest, vectorsSha256: undefined })).ok).toBe(false)
    expect(parseManifest(JSON.stringify({ ...manifest, entries: 'nope' })).ok).toBe(false)
    expect(parseManifest(JSON.stringify({ ...manifest, entries: [{ id: 'only-id' }] })).ok).toBe(
      false
    )
    expect(parseManifest('null').ok).toBe(false)
  })
})
