import { parseArtifact } from './parser'
import { buildGraph } from './graph-builder'
import { SearchEngine } from '@shared/engine/search-engine'
import type { SearchHit } from '@shared/engine/search-engine'
import type { PdfPageText } from '@shared/engine/pdf-extractor'
import type { Artifact } from '@shared/types'
import type { ParseError, WorkerResult } from './types'

export type WorkerInMessage =
  | { type: 'load'; files: ReadonlyArray<{ path: string; content: string }> }
  | { type: 'append'; files: ReadonlyArray<{ path: string; content: string }> }
  | {
      type: 'update-many'
      updates: ReadonlyArray<{ path: string; content: string }>
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
  addFile: (path: string, content: string) => void
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

  function addFile(path: string, content: string): void {
    clearErrorsForPath(path)
    const result = parseArtifact(content, path)
    if (result.ok) {
      let id = result.value.id
      if (artifacts.has(id)) {
        let suffix = 2
        while (artifacts.has(`${id}-${suffix}`)) suffix++
        id = `${id}-${suffix}`
      }
      const artifact = id !== result.value.id ? { ...result.value, id } : result.value
      artifacts.set(id, artifact)
      fileToId.set(path, id)
      artifactPathById.set(id, path)
      searchEngine.upsert({
        id,
        title: artifact.title,
        tags: artifact.tags ?? [],
        body: artifact.body ?? '',
        path
      })
    } else {
      errors.push({ filename: path, error: result.error })
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

  return { addFile, removeFile, buildResult, clearAll, search, indexPdf }
}

/** Minimum gap between graph rebuilds posted during chunked appends. */
export const APPEND_POST_INTERVAL_MS = 1000

/**
 * Message-handling core of the vault worker, factored out of the worker shell
 * so it can be unit-tested with fake timers.
 *
 * Rebuild policy:
 * - `load` (first chunk) rebuilds and posts immediately so the UI has content.
 * - `append` (background chunks) throttles to one rebuild+post per
 *   APPEND_POST_INTERVAL_MS, with a trailing timer that guarantees one final
 *   post covering every appended file. Without this, a 5k-note vault does
 *   ~100 escalating O(n²) graph rebuilds during hydration.
 * - `update-many` (one watcher batch) applies every remove+update, then does a
 *   single rebuild — instead of one rebuild per changed file.
 * - `search` (human full-text query) answers from the hosted SearchEngine with
 *   no graph rebuild; the response carries the caller's requestId.
 * - `index-pdf` (3.10a) upserts per-page PDF text into the SearchEngine only —
 *   no artifact, no graph rebuild, no post. PDFs are searchable, not parsed.
 */
export function createWorkerController(
  post: (msg: WorkerMessage) => void,
  intervalMs: number = APPEND_POST_INTERVAL_MS
): { handleMessage: (msg: WorkerInMessage) => void } {
  const { addFile, removeFile, buildResult, clearAll, search, indexPdf } = createWorkerHelpers()
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
        for (const file of msg.files) addFile(file.path, file.content)
        postNow('loaded')
        break
      case 'append':
        for (const file of msg.files) addFile(file.path, file.content)
        postThrottled()
        break
      case 'update-many':
        for (const path of msg.removes) removeFile(path)
        for (const file of msg.updates) {
          removeFile(file.path)
          addFile(file.path, file.content)
        }
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
