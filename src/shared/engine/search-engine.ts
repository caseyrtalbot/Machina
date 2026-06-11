import MiniSearch from 'minisearch'
import type { PdfPageText } from './pdf-extractor'

export interface SearchDoc {
  readonly id: string
  readonly title: string
  readonly tags: readonly string[]
  readonly body: string
  readonly path: string
  /** 1-based page number for per-page PDF docs (3.10a); absent for notes. */
  readonly page?: number
}

export interface SearchHit {
  readonly id: string
  readonly title: string
  readonly path: string
  readonly snippet: string
  readonly score: number
  /** Page-number hint when the hit is a PDF page (3.10a). */
  readonly page?: number
  /** True when the hit came from the local embedding index (3.11), so the UI
   * can hint "semantic". Scores are cosine similarities, not comparable to
   * lexical MiniSearch scores. */
  readonly semantic?: boolean
}

/** When both lists overflow `limit`, this many slots are reserved for
 * semantic hits so they are not starved by an exact-match flood. */
const SEMANTIC_RESERVED_SLOTS = 3

/**
 * Merge semantic hits into a lexical result list (3.11). Lexical hits keep
 * their order and come first (exact matches read as more trustworthy);
 * semantic hits are deduplicated by id, marked `semantic: true`, and appended.
 * When the merged list would overflow `limit`, up to SEMANTIC_RESERVED_SLOTS
 * are guaranteed to semantic hits.
 */
export function mergeSemanticHits(
  lexical: readonly SearchHit[],
  semantic: readonly SearchHit[],
  limit: number
): SearchHit[] {
  if (limit <= 0) return []
  const lexicalIds = new Set(lexical.map((hit) => hit.id))
  const extras = semantic
    .filter((hit) => !lexicalIds.has(hit.id))
    .map((hit) => ({ ...hit, semantic: true }))

  if (lexical.length + extras.length <= limit) return [...lexical, ...extras]

  const semanticSlots = Math.min(extras.length, SEMANTIC_RESERVED_SLOTS, limit)
  const lexicalKept = Math.min(lexical.length, limit - semanticSlots)
  return [...lexical.slice(0, lexicalKept), ...extras.slice(0, limit - lexicalKept)]
}

const SNIPPET_HALF = 60
const MAX_SNIPPET_LENGTH = 140

function extractSnippet(body: string, queryTerms: readonly string[]): string {
  if (!body) return ''
  const lower = body.toLowerCase()
  let bestIndex = -1

  for (const term of queryTerms) {
    const idx = lower.indexOf(term.toLowerCase())
    if (idx !== -1) {
      bestIndex = idx
      break
    }
  }

  if (bestIndex === -1) {
    return (
      body.slice(0, MAX_SNIPPET_LENGTH).trim() + (body.length > MAX_SNIPPET_LENGTH ? '...' : '')
    )
  }

  const start = Math.max(0, bestIndex - SNIPPET_HALF)
  const end = Math.min(body.length, bestIndex + SNIPPET_HALF)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < body.length ? '...' : ''
  return `${prefix}${body.slice(start, end).trim()}${suffix}`
}

export class SearchEngine {
  private index: MiniSearch
  private docs = new Map<string, SearchDoc>()
  /** Doc ids per indexed PDF path, so re-indexing replaces stale pages. */
  private pdfDocIds = new Map<string, readonly string[]>()
  /** Fired after any content mutation (3.11): the embedder service debounces
   * these into incremental re-embeds, covering notes and PDF pages alike. */
  private changeListener: (() => void) | null = null

  constructor() {
    this.index = new MiniSearch({
      fields: ['title', 'tagsText', 'body'],
      storeFields: ['title', 'path'],
      searchOptions: {
        boost: { title: 10, tagsText: 5, body: 1 },
        prefix: true,
        fuzzy: 0.2
      }
    })
  }

  upsert(doc: SearchDoc): void {
    if (this.docs.has(doc.id)) {
      this.index.discard(doc.id)
    }
    const indexed = {
      id: doc.id,
      title: doc.title,
      tagsText: doc.tags.join(' '),
      body: doc.body,
      path: doc.path
    }
    this.index.add(indexed)
    this.docs.set(doc.id, doc)
    this.changeListener?.()
  }

  remove(id: string): void {
    if (!this.docs.has(id)) return
    this.index.discard(id)
    this.docs.delete(id)
    this.changeListener?.()
  }

  /** Register (or with null, clear) the post-mutation listener. One consumer:
   * the main-process embedder service. */
  setChangeListener(listener: (() => void) | null): void {
    this.changeListener = listener
  }

  getDoc(id: string): SearchDoc | undefined {
    return this.docs.get(id)
  }

  /** Snapshot of every indexed doc (notes and PDF pages alike) — the corpus
   * the embedder service hashes and embeds, with no source distinction. */
  allDocs(): readonly SearchDoc[] {
    return [...this.docs.values()]
  }

  /**
   * Index a PDF as one searchable doc per non-empty page (3.10a). Replaces any
   * previously indexed pages for the same path, so shrinking PDFs drop their
   * stale tail. The `pdf` tag marks hits as PDF-sourced; `path` is the PDF
   * itself and `page` carries the 1-based page hint into SearchHit.
   */
  indexPdfPages(pdfPath: string, pages: readonly PdfPageText[]): void {
    for (const id of this.pdfDocIds.get(pdfPath) ?? []) {
      this.remove(id)
    }
    const segments = pdfPath.split('/')
    const title = segments[segments.length - 1] || pdfPath
    const ids: string[] = []
    for (const { page, text } of pages) {
      if (!text.trim()) continue
      const id = `pdf:${pdfPath}#p${page}`
      this.upsert({ id, title, tags: ['pdf'], body: text, path: pdfPath, page })
      ids.push(id)
    }
    this.pdfDocIds.set(pdfPath, ids)
  }

  search(query: string, limit = 20): SearchHit[] {
    if (!query.trim()) return []
    const results = this.index.search(query)
    const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean)

    return results.slice(0, limit).map((result) => {
      const doc = this.docs.get(result.id)
      return {
        id: result.id,
        title: (doc?.title ?? result.title) as string,
        path: (doc?.path ?? result.path) as string,
        snippet: doc ? extractSnippet(doc.body, queryTerms) : '',
        score: result.score,
        ...(doc?.page !== undefined ? { page: doc.page } : {})
      }
    })
  }

  clear(): void {
    this.index.removeAll()
    this.docs.clear()
    this.pdfDocIds.clear()
    this.changeListener?.()
  }

  get size(): number {
    return this.docs.size
  }
}
