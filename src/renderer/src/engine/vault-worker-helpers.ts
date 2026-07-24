import { buildGraph } from './graph-builder'
import { SearchEngine } from '@shared/engine/search-engine'
import type { SearchHit } from '@shared/engine/search-engine'
import type { PdfPageText } from '@shared/engine/pdf-extractor'
import type { Artifact } from '@shared/types'
import type { VaultIndexEntry } from '@shared/index-delta'
import type { ParseError, WorkerResult } from './types'

export type WorkerInMessage =
  | { type: 'load'; entries: ReadonlyArray<VaultIndexEntry> }
  | { type: 'append'; entries: ReadonlyArray<VaultIndexEntry> }
  | {
      type: 'apply-delta'
      upserts: ReadonlyArray<VaultIndexEntry>
      removes: readonly string[]
    }
  | { type: 'search'; requestId: number; query: string; limit?: number }
  | { type: 'index-pdf'; pdfPath: string; pages: ReadonlyArray<PdfPageText> }

export type WorkerOutMessage = { type: 'loaded' | 'updated' } & WorkerResult

export interface WorkerSearchResponse {
  readonly type: 'search-results'
  readonly requestId: number
  readonly hits: readonly SearchHit[]
}

export type WorkerMessage = WorkerOutMessage | WorkerSearchResponse

interface WorkerHelpers {
  ingestEntry: (entry: VaultIndexEntry) => void
  removeFile: (path: string) => void
  buildResult: () => WorkerResult
  clearAll: () => void
  search: (query: string, limit?: number) => SearchHit[]
  indexPdf: (pdfPath: string, pages: readonly PdfPageText[]) => void
}

export function createWorkerHelpers(): WorkerHelpers {
  const artifacts = new Map<string, Artifact>()
  const fileToId = new Map<string, string>()
  const artifactPathById = new Map<string, string>()
  const errors: ParseError[] = []
  // Full-text engine for human search (3.1) — lives here because the worker
  // already holds every parsed body; queries never touch the UI thread.
  const searchEngine = new SearchEngine()

  function clearErrorsForPath(path: string): void {
    for (let i = errors.length - 1; i >= 0; i--) {
      if (errors[i].filename === path) errors.splice(i, 1)
    }
  }

  function ingestEntry(entry: VaultIndexEntry): void {
    // Main's index is the single parse authority; ids arrive resolved, so we
    // trust them (no renderer-side collision suffixing). Drop whatever this
    // path previously contributed — artifact or error — and replace it.
    removeFile(entry.path)
    if (entry.artifact) {
      const artifact = entry.artifact
      artifacts.set(artifact.id, artifact)
      fileToId.set(entry.path, artifact.id)
      artifactPathById.set(artifact.id, entry.path)
      searchEngine.upsert({
        id: artifact.id,
        title: artifact.title,
        tags: artifact.tags ?? [],
        body: artifact.body ?? '',
        path: entry.path
      })
    } else if (entry.error) {
      errors.push({ filename: entry.path, error: entry.error.error })
    }
  }

  function removeFile(path: string): void {
    clearErrorsForPath(path)
    const id = fileToId.get(path)
    if (id) {
      artifacts.delete(id)
      fileToId.delete(path)
      artifactPathById.delete(id)
      searchEngine.remove(id)
    }
  }

  function search(query: string, limit?: number): SearchHit[] {
    return searchEngine.search(query, limit)
  }

  function indexPdf(pdfPath: string, pages: readonly PdfPageText[]): void {
    searchEngine.indexPdfPages(pdfPath, pages)
  }

  function buildResult(): WorkerResult {
    const arts = Array.from(artifacts.values())
    const graph = buildGraph(arts)
    const fToId: Record<string, string> = {}
    const aToPath: Record<string, string> = {}
    for (const [k, v] of fileToId) fToId[k] = v
    for (const [k, v] of artifactPathById) aToPath[k] = v
    return {
      artifacts: arts,
      graph,
      errors: [...errors],
      fileToId: fToId,
      artifactPathById: aToPath
    }
  }

  function clearAll(): void {
    artifacts.clear()
    fileToId.clear()
    artifactPathById.clear()
    errors.length = 0
    searchEngine.clear()
  }

  return { ingestEntry, removeFile, buildResult, clearAll, search, indexPdf }
}

/** Minimum gap between graph rebuilds posted during chunked appends. */
export const APPEND_POST_INTERVAL_MS = 1000

/**
 * Message-handling core of the vault worker, factored out of the worker shell
 * so it can be unit-tested with fake timers.
 *
 * Entries arrive pre-parsed from main's VaultIndex (the single parse
 * authority); the worker ingests them and never parses markdown itself.
 *
 * Rebuild policy:
 * - `load` (first chunk) rebuilds and posts immediately so the UI has content.
 * - `append` (background chunks) throttles to one rebuild+post per
 *   APPEND_POST_INTERVAL_MS, with a trailing timer that guarantees one final
 *   post covering every appended entry. Without this, a 5k-note vault does
 *   ~100 escalating O(n²) graph rebuilds during hydration.
 * - `apply-delta` (one watcher batch, parsed by main) applies every
 *   remove+upsert, then does a single rebuild — instead of one per change.
 * - `search` (human full-text query) answers from the hosted SearchEngine with
 *   no graph rebuild; the response carries the caller's requestId.
 * - `index-pdf` (3.10a) upserts per-page PDF text into the SearchEngine only —
 *   no artifact, no graph rebuild, no post. PDFs are searchable, not parsed.
 */
export function createWorkerController(
  post: (msg: WorkerMessage) => void,
  intervalMs: number = APPEND_POST_INTERVAL_MS
): { handleMessage: (msg: WorkerInMessage) => void } {
  const { ingestEntry, removeFile, buildResult, clearAll, search, indexPdf } = createWorkerHelpers()
  let appendTimer: ReturnType<typeof setTimeout> | undefined
  let lastPostAt = Number.NEGATIVE_INFINITY

  function postNow(msgType: 'loaded' | 'updated'): void {
    if (appendTimer !== undefined) {
      clearTimeout(appendTimer)
      appendTimer = undefined
    }
    lastPostAt = Date.now()
    post({ type: msgType, ...buildResult() })
  }

  function postThrottled(): void {
    if (appendTimer !== undefined) return // trailing post pending; it will see this batch
    const wait = intervalMs - (Date.now() - lastPostAt)
    if (wait <= 0) {
      postNow('loaded')
      return
    }
    appendTimer = setTimeout(() => {
      appendTimer = undefined
      postNow('loaded')
    }, wait)
  }

  function handleMessage(msg: WorkerInMessage): void {
    switch (msg.type) {
      case 'load':
        clearAll()
        for (const entry of msg.entries) ingestEntry(entry)
        postNow('loaded')
        break
      case 'append':
        for (const entry of msg.entries) ingestEntry(entry)
        postThrottled()
        break
      case 'apply-delta':
        for (const path of msg.removes) removeFile(path)
        for (const entry of msg.upserts) ingestEntry(entry)
        postNow('updated')
        break
      case 'search':
        post({
          type: 'search-results',
          requestId: msg.requestId,
          hits: search(msg.query, msg.limit)
        })
        break
      case 'index-pdf':
        indexPdf(msg.pdfPath, msg.pages)
        break
    }
  }

  return { handleMessage }
}
