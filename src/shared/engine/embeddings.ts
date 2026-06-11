import type { Result } from './types'

/**
 * Pure embedding interfaces + vector math for local semantic search (3.11).
 * The main-process EmbedderService owns the model, storage, hashing, and
 * debounce; this module stays dependency-free so it can be unit-tested and
 * imported from any process.
 */

/** transformers.js ONNX sentence-transformer used by the main-process embedder. */
export const EMBEDDING_MODEL_ID = 'Xenova/all-MiniLM-L6-v2'
/** Output dimensionality of EMBEDDING_MODEL_ID. */
export const EMBEDDING_DIM = 384
/** One-time download size surfaced in the Settings opt-in toggle copy. */
export const EMBEDDING_MODEL_DOWNLOAD_MB = 25

/** One embedded document: mirrors a SearchDoc, plus the content hash used
 * for incremental re-embedding. Vector lives at `index * dim` in the flat
 * `.f32` file, in manifest entry order. */
export interface EmbeddingEntry {
  readonly id: string
  readonly path: string
  readonly title: string
  readonly hash: string
  /** 1-based page number for PDF-page docs; absent for notes. */
  readonly page?: number
}

export interface EmbeddingManifest {
  readonly version: 1
  readonly modelId: string
  readonly dim: number
  /** sha256 hex of the companion `.f32` file. Detects same-length byte
   * corruption and a manifest/vector pair from different write generations. */
  readonly vectorsSha256: string
  readonly entries: readonly EmbeddingEntry[]
}

/** Async text → vector, implemented in the main process over transformers.js. */
export interface QueryEmbedder {
  embed(text: string): Promise<Float32Array>
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export interface SimilarityHit {
  readonly index: number
  readonly score: number
}

/**
 * Cosine top-K over a flat vector store (`vectors.length / dim` rows).
 * Returns up to k hits sorted by descending score; rows whose dimension
 * cannot be sliced (truncated store) are skipped.
 */
export function topKSimilar(
  query: Float32Array,
  vectors: Float32Array,
  dim: number,
  k: number
): readonly SimilarityHit[] {
  if (dim <= 0 || k <= 0 || query.length !== dim) return []
  const count = Math.floor(vectors.length / dim)
  const hits: SimilarityHit[] = []
  for (let i = 0; i < count; i++) {
    const row = vectors.subarray(i * dim, (i + 1) * dim)
    hits.push({ index: i, score: cosineSimilarity(query, row) })
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, k)
}

function isEntry(value: unknown): value is EmbeddingEntry {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.path === 'string' &&
    typeof v.title === 'string' &&
    typeof v.hash === 'string' &&
    (v.page === undefined || typeof v.page === 'number')
  )
}

/**
 * Parse + structurally validate a manifest. Any malformed input — bad JSON,
 * wrong version, non-array entries, malformed entry — returns `ok: false`
 * so callers fall back to an empty store (lexical-only until re-embedded).
 */
export function parseManifest(json: string): Result<EmbeddingManifest> {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return { ok: false, error: 'manifest is not valid JSON' }
  }
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'manifest is not an object' }
  }
  const m = raw as Record<string, unknown>
  if (m.version !== 1) return { ok: false, error: 'unsupported manifest version' }
  if (typeof m.modelId !== 'string') return { ok: false, error: 'manifest missing modelId' }
  if (typeof m.dim !== 'number' || m.dim <= 0) return { ok: false, error: 'manifest missing dim' }
  if (typeof m.vectorsSha256 !== 'string') {
    return { ok: false, error: 'manifest missing vectorsSha256' }
  }
  if (!Array.isArray(m.entries) || !m.entries.every(isEntry)) {
    return { ok: false, error: 'manifest entries malformed' }
  }
  return {
    ok: true,
    value: {
      version: 1,
      modelId: m.modelId,
      dim: m.dim,
      vectorsSha256: m.vectorsSha256,
      entries: m.entries
    }
  }
}

export function serializeManifest(manifest: EmbeddingManifest): string {
  return JSON.stringify(manifest)
}
