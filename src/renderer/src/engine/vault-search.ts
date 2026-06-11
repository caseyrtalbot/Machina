import { mergeSemanticHits, type SearchHit } from '@shared/engine/search-engine'
import type { PdfPageText } from '@shared/engine/pdf-extractor'
import { useSettingsStore } from '../store/settings-store'

/**
 * Renderer-side client for the full-text SearchEngine hosted inside the vault
 * worker (3.1). `useVaultWorker` registers the live worker on mount and routes
 * `search-results` messages here; `searchVault` is callable from anywhere in
 * the renderer (command palette, sidebar SearchBar). `indexPdfInSearch` (3.10a)
 * feeds extracted per-page PDF text into the same index.
 *
 * When the opt-in semantic-search setting is on (3.11), `searchVault` also
 * queries the main-process embedding index over IPC and merges those hits
 * (marked `semantic`) into the same list. Off = zero embeddings IPC traffic.
 */

export type SearchWorkerMessage =
  | { type: 'search'; requestId: number; query: string; limit?: number }
  | { type: 'index-pdf'; pdfPath: string; pages: ReadonlyArray<PdfPageText> }

/** Minimal worker surface so tests can register a fake. */
export interface SearchWorkerPort {
  postMessage: (msg: SearchWorkerMessage) => void
}

interface PendingSearch {
  readonly resolve: (hits: readonly SearchHit[]) => void
  readonly timer: ReturnType<typeof setTimeout>
}

const SEARCH_TIMEOUT_MS = 5000

let searchWorker: SearchWorkerPort | null = null
let nextRequestId = 1
const pending = new Map<number, PendingSearch>()

/** Cap on semantic hits requested per query — merge reserves few slots anyway. */
const SEMANTIC_K = 8

/** The embeddings IPC surface, or null when the setting is off or the bridge
 * is absent (unit tests). Null means semantic search silently degrades to
 * lexical-only with no IPC traffic. */
function semanticApi(): {
  setEnabled: (enabled: boolean) => Promise<void>
  search: (query: string, k?: number) => Promise<SearchHit[]>
} | null {
  if (!useSettingsStore.getState().semanticSearch) return null
  if (typeof window === 'undefined') return null
  return window.api?.embeddings ?? null
}

/** Register (or on null, unregister) the vault worker. Unregistering resolves in-flight queries empty. */
export function registerSearchWorker(worker: SearchWorkerPort | null): void {
  searchWorker = worker
  if (worker === null) {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.resolve([])
    }
    pending.clear()
  }
  // Startup sync: a persisted opt-in re-enables the main-process embedder when
  // the vault worker comes up. The IPC layer holds the flag if the vault index
  // (and thus the service) is not built yet.
  if (worker !== null) {
    void semanticApi()
      ?.setEnabled(true)
      .catch(() => {})
  }
}

/** Route a `search-results` worker message to its awaiting caller. */
export function deliverSearchResults(msg: {
  readonly requestId: number
  readonly hits: readonly SearchHit[]
}): void {
  const entry = pending.get(msg.requestId)
  if (!entry) return
  pending.delete(msg.requestId)
  clearTimeout(entry.timer)
  entry.resolve(msg.hits)
}

function lexicalSearch(query: string, limit: number): Promise<readonly SearchHit[]> {
  const worker = searchWorker
  if (!worker || !query.trim()) return Promise.resolve([])
  const requestId = nextRequestId++
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId)
      resolve([])
    }, SEARCH_TIMEOUT_MS)
    pending.set(requestId, { resolve, timer })
    worker.postMessage({ type: 'search', requestId, query, limit })
  })
}

/**
 * Full-text search across every parsed note body. Resolves to [] when the
 * worker is not yet registered, the query is blank, or the worker does not
 * answer within SEARCH_TIMEOUT_MS — callers never hang. With semantic search
 * enabled, embedding hits are merged in (marked `semantic`); any embeddings
 * failure degrades silently to the lexical results.
 */
export async function searchVault(query: string, limit = 20): Promise<readonly SearchHit[]> {
  const lexicalPromise = lexicalSearch(query, limit)
  const api = semanticApi()
  if (!api || !query.trim()) return lexicalPromise
  const [lexical, semantic] = await Promise.all([
    lexicalPromise,
    api.search(query, Math.min(limit, SEMANTIC_K)).catch(() => [] as SearchHit[])
  ])
  if (semantic.length === 0) return lexical
  return mergeSemanticHits(lexical, semantic, limit)
}

/**
 * Upsert a PDF's extracted per-page text into the vault-worker search index
 * (3.10a). Fire-and-forget: a no-op when the worker is not yet registered —
 * the PDF re-indexes the next time its card loads.
 */
export function indexPdfInSearch(pdfPath: string, pages: readonly PdfPageText[]): void {
  searchWorker?.postMessage({ type: 'index-pdf', pdfPath, pages: [...pages] })
}
