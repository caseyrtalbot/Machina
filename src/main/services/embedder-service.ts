import { mkdir, open, readFile, rename } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import {
  EMBEDDING_DIM,
  EMBEDDING_MODEL_ID,
  parseManifest,
  serializeManifest,
  topKSimilar,
  type EmbeddingEntry,
  type EmbeddingManifest
} from '@shared/engine/embeddings'
import type { SearchDoc, SearchEngine, SearchHit } from '@shared/engine/search-engine'

/**
 * Main-process local-embedding service (3.11). Strictly opt-in: nothing is
 * loaded, downloaded, or written until setEnabled(true). Once enabled it
 * subscribes to the live SearchEngine (notes + PDF pages, no distinction),
 * re-embeds only changed docs on a ~1s debounce, and persists vectors as a
 * flat .f32 file + manifest under `<vault>/<TE_DIR>/embeddings/` with
 * atomic tmp+rename writes. A corrupt or mismatched store is discarded —
 * search degrades to lexical-only until the rebuild lands.
 */

/** Batch text → normalized vectors. Injectable so tests skip the real model. */
export type EmbedFn = (texts: readonly string[]) => Promise<readonly Float32Array[]>

export type EmbedderState = 'off' | 'loading-model' | 'indexing' | 'ready' | 'error'

export interface EmbedderStatus {
  readonly enabled: boolean
  readonly state: EmbedderState
  readonly docCount: number
  readonly error?: string
}

export interface EmbedderServiceOptions {
  /** Directory holding manifest.json + vectors.f32 (created on first enable). */
  readonly storageDir: string
  /** Override the model loader; defaults to transformers.js (lazy download). */
  readonly loadEmbedder?: () => Promise<EmbedFn>
  /** Re-embed debounce after index changes. */
  readonly debounceMs?: number
  /** Where transformers.js caches the downloaded model (default loader only). */
  readonly modelCacheDir?: string
}

const MANIFEST_FILE = 'manifest.json'
const VECTORS_FILE = 'vectors.f32'
const DEFAULT_DEBOUNCE_MS = 1000
/** The model truncates around 256 tokens; embedding more text is wasted work. */
const EMBED_MAX_CHARS = 1500
const EMBED_BATCH_SIZE = 8
const SNIPPET_LENGTH = 140
/** Cosine floor: below this the doc is unrelated noise, not a weak match. */
const MIN_SEMANTIC_SCORE = 0.25

function contentHash(doc: SearchDoc): string {
  return createHash('sha256').update(`${doc.title}\n${doc.body}`).digest('hex')
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function embedInput(doc: SearchDoc): string {
  return `${doc.title}\n${doc.body}`.slice(0, EMBED_MAX_CHARS)
}

/** Crash-safe binary/string write: stage to a same-dir temp, fsync, rename. */
async function atomicWriteBytes(path: string, data: Uint8Array | string): Promise<void> {
  const tmpPath = `${path}.tmp`
  const handle = await open(tmpPath, 'w')
  try {
    await handle.writeFile(data)
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(tmpPath, path)
}

async function loadTransformersEmbedder(modelCacheDir?: string): Promise<EmbedFn> {
  const { pipeline, env } = await import('@huggingface/transformers')
  if (modelCacheDir) env.cacheDir = modelCacheDir
  const extractor = await pipeline('feature-extraction', EMBEDDING_MODEL_ID, { dtype: 'q8' })
  return async (texts) => {
    if (texts.length === 0) return []
    const output = await extractor([...texts], { pooling: 'mean', normalize: true })
    const data = output.data as Float32Array
    return texts.map(
      (_, i) => new Float32Array(data.subarray(i * EMBEDDING_DIM, (i + 1) * EMBEDDING_DIM))
    )
  }
}

export class EmbedderService {
  private readonly storageDir: string
  private readonly loadEmbedder: () => Promise<EmbedFn>
  private readonly debounceMs: number

  private engine: SearchEngine | null = null
  private embedFn: EmbedFn | null = null
  private enabled = false
  private disposed = false
  private state: EmbedderState = 'off'
  private lastError: string | undefined

  /** Manifest entries; row i's vector lives at vectors[i*dim .. (i+1)*dim). */
  private entries: readonly EmbeddingEntry[] = []
  private vectors = new Float32Array(0)
  private storeLoaded = false

  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private reindexInFlight: Promise<void> | null = null
  private reindexQueued = false
  private enabling: Promise<void> | null = null

  constructor(opts: EmbedderServiceOptions) {
    this.storageDir = opts.storageDir
    this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS
    this.loadEmbedder = opts.loadEmbedder ?? (() => loadTransformersEmbedder(opts.modelCacheDir))
  }

  /** Point the service at the live SearchEngine. Subscribes only once enabled. */
  attach(engine: SearchEngine): void {
    this.engine = engine
    if (this.enabled) engine.setChangeListener(() => this.scheduleReindex())
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (this.disposed) return
    if (!enabled) {
      this.enabled = false
      this.state = 'off'
      this.clearDebounce()
      this.engine?.setChangeListener(null)
      return
    }
    if (this.enabled) {
      await this.enabling
      return
    }
    this.enabled = true
    this.engine?.setChangeListener(() => this.scheduleReindex())
    this.enabling = this.enableInner().finally(() => {
      this.enabling = null
    })
    await this.enabling
  }

  private async enableInner(): Promise<void> {
    try {
      if (!this.storeLoaded) {
        await this.loadStore()
        this.storeLoaded = true
      }
      if (!this.embedFn) {
        this.state = 'loading-model'
        this.embedFn = await this.loadEmbedder()
      }
      if (!this.enabled || this.disposed) return
      this.state = 'ready'
      await this.runReindex()
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err)
      this.state = 'error'
    }
  }

  status(): EmbedderStatus {
    return {
      enabled: this.enabled,
      state: this.state,
      docCount: this.entries.length,
      ...(this.lastError !== undefined ? { error: this.lastError } : {})
    }
  }

  /**
   * Embed the query and return the cosine top-K as SearchHits marked
   * `semantic`. Empty until the service is enabled, the model is loaded,
   * and at least one re-embed pass has produced vectors.
   */
  async search(query: string, k: number): Promise<SearchHit[]> {
    if (!this.enabled || !this.embedFn || !query.trim() || this.entries.length === 0) return []
    let queryVector: Float32Array
    try {
      const [vector] = await this.embedFn([query])
      if (!vector) return []
      queryVector = vector
    } catch {
      return []
    }
    const top = topKSimilar(queryVector, this.vectors, EMBEDDING_DIM, k)
    return top.flatMap(({ index, score }) => {
      // !(score >= floor) also rejects NaN, which `score < floor` lets through.
      const entry = this.entries[index]
      if (!entry || !(score >= MIN_SEMANTIC_SCORE)) return []
      const body = this.engine?.getDoc(entry.id)?.body ?? ''
      return [
        {
          id: entry.id,
          title: entry.title,
          path: entry.path,
          snippet: body.slice(0, SNIPPET_LENGTH),
          score,
          semantic: true as const,
          ...(entry.page !== undefined ? { page: entry.page } : {})
        }
      ]
    })
  }

  /** Detach from the engine and stop timers (vault switch / shutdown). */
  dispose(): void {
    this.disposed = true
    this.enabled = false
    this.state = 'off'
    this.clearDebounce()
    this.engine?.setChangeListener(null)
    this.engine = null
  }

  /** Re-embed after the configured debounce; exposed for tests. */
  scheduleReindex(): void {
    if (!this.enabled || this.disposed) return
    this.clearDebounce()
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      void this.runReindex()
    }, this.debounceMs)
  }

  /** Single-flight incremental re-embed; overlapping requests coalesce. */
  private runReindex(): Promise<void> {
    if (this.reindexInFlight) {
      this.reindexQueued = true
      return this.reindexInFlight
    }
    this.reindexInFlight = this.reindexOnce()
      .catch((err) => {
        this.lastError = err instanceof Error ? err.message : String(err)
        this.state = 'error'
      })
      .finally(() => {
        this.reindexInFlight = null
        if (this.reindexQueued) {
          this.reindexQueued = false
          void this.runReindex()
        }
      })
    return this.reindexInFlight
  }

  private async reindexOnce(): Promise<void> {
    const engine = this.engine
    const embedFn = this.embedFn
    if (!engine || !embedFn || !this.enabled || this.disposed) return

    const docs = engine.allDocs()
    const hashes = docs.map((doc) => contentHash(doc))
    const previous = new Map(this.entries.map((entry, i) => [entry.id, { entry, row: i }]))

    // Path/page must match too: a rename with a stable frontmatter id keeps
    // the content hash, but the stored entry would point at the old path.
    const unchanged =
      docs.length === this.entries.length &&
      docs.every((doc, i) => {
        const prev = previous.get(doc.id)
        return (
          prev !== undefined &&
          prev.entry.hash === hashes[i] &&
          prev.entry.path === doc.path &&
          prev.entry.page === doc.page
        )
      })
    if (unchanged) {
      this.state = 'ready'
      return
    }

    this.state = 'indexing'
    const toEmbed: number[] = []
    for (let i = 0; i < docs.length; i++) {
      const prev = previous.get(docs[i].id)
      if (!prev || prev.entry.hash !== hashes[i]) toEmbed.push(i)
    }

    const embedded = new Map<number, Float32Array>()
    for (let start = 0; start < toEmbed.length; start += EMBED_BATCH_SIZE) {
      const batch = toEmbed.slice(start, start + EMBED_BATCH_SIZE)
      const vectors = await embedFn(batch.map((i) => embedInput(docs[i])))
      batch.forEach((docIndex, j) => {
        const vector = vectors[j]
        if (vector) embedded.set(docIndex, vector)
      })
    }

    const nextVectors = new Float32Array(docs.length * EMBEDDING_DIM)
    const nextEntries: EmbeddingEntry[] = []
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i]
      const fresh = embedded.get(i)
      if (fresh) {
        nextVectors.set(fresh.subarray(0, EMBEDDING_DIM), i * EMBEDDING_DIM)
      } else {
        const prev = previous.get(doc.id)
        if (!prev) continue
        nextVectors.set(
          this.vectors.subarray(prev.row * EMBEDDING_DIM, (prev.row + 1) * EMBEDDING_DIM),
          i * EMBEDDING_DIM
        )
      }
      nextEntries.push({
        id: doc.id,
        path: doc.path,
        title: doc.title,
        hash: hashes[i],
        ...(doc.page !== undefined ? { page: doc.page } : {})
      })
    }

    this.entries = nextEntries
    this.vectors = nextVectors.subarray(0, nextEntries.length * EMBEDDING_DIM)
    await this.persistStore()
    if (this.state === 'indexing') this.state = 'ready'
  }

  /**
   * Load manifest + vectors from disk. Any inconsistency — unparseable
   * manifest, wrong model/dim, vector byte length not matching the entry
   * count, vector bytes not matching the manifest checksum — discards the
   * store: semantic search stays empty (lexical-only) until the next
   * re-embed rebuilds it.
   */
  private async loadStore(): Promise<void> {
    let manifestJson: string
    let vectorBytes: Buffer
    try {
      manifestJson = await readFile(join(this.storageDir, MANIFEST_FILE), 'utf-8')
      vectorBytes = await readFile(join(this.storageDir, VECTORS_FILE))
    } catch {
      return // first run: nothing persisted yet
    }
    const parsed = parseManifest(manifestJson)
    if (!parsed.ok) return
    const manifest = parsed.value
    if (manifest.modelId !== EMBEDDING_MODEL_ID || manifest.dim !== EMBEDDING_DIM) return
    if (vectorBytes.byteLength !== manifest.entries.length * EMBEDDING_DIM * 4) return
    // Same-length corruption (or a manifest/vector pair from different write
    // generations) passes the length check; the checksum catches it.
    if (sha256Hex(vectorBytes) !== manifest.vectorsSha256) return
    this.entries = manifest.entries
    // Copy into a fresh ArrayBuffer: Buffers can be views into a shared pool.
    const copy = new Uint8Array(vectorBytes.byteLength)
    copy.set(vectorBytes)
    this.vectors = new Float32Array(copy.buffer)
  }

  /** Vectors first, manifest second: a crash in between leaves the old
   * manifest pointing at a .f32 whose checksum (or length) no longer
   * matches, which loadStore discards. */
  private async persistStore(): Promise<void> {
    await mkdir(this.storageDir, { recursive: true })
    const vectorBytes = new Uint8Array(
      this.vectors.buffer,
      this.vectors.byteOffset,
      this.vectors.byteLength
    )
    const manifest: EmbeddingManifest = {
      version: 1,
      modelId: EMBEDDING_MODEL_ID,
      dim: EMBEDDING_DIM,
      vectorsSha256: sha256Hex(vectorBytes),
      entries: this.entries
    }
    await atomicWriteBytes(join(this.storageDir, VECTORS_FILE), vectorBytes)
    await atomicWriteBytes(join(this.storageDir, MANIFEST_FILE), serializeManifest(manifest))
  }

  private clearDebounce(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }
}
