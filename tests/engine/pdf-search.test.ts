import { describe, it, expect } from 'vitest'
import { SearchEngine } from '@shared/engine/search-engine'
import { createWorkerController } from '@engine/vault-worker-helpers'
import type {
  WorkerInMessage,
  WorkerMessage,
  WorkerSearchResponse
} from '@engine/vault-worker-helpers'

const PDF_PATH = '/vault/papers/three-page.pdf'
const PAGES = [
  { page: 1, text: 'First page introduces the fixture document.' },
  { page: 2, text: 'The luminous archive sits quietly on page two.' },
  { page: 3, text: 'Third page concludes the fixture with a farewell.' }
]

describe('SearchEngine.indexPdfPages', () => {
  it('finds a page-2 phrase with a page hint, pdf path, and filename title', () => {
    const engine = new SearchEngine()
    engine.indexPdfPages(PDF_PATH, PAGES)

    const hits = engine.search('luminous archive')
    expect(hits).toHaveLength(1)
    expect(hits[0].page).toBe(2)
    expect(hits[0].path).toBe(PDF_PATH)
    expect(hits[0].title).toBe('three-page.pdf')
    expect(hits[0].snippet).toContain('luminous archive')
  })

  it('leaves note hits without a page hint', () => {
    const engine = new SearchEngine()
    engine.upsert({ id: 'n1', title: 'Note', tags: [], body: 'plain note body', path: '/v/n.md' })
    const hits = engine.search('plain note')
    expect(hits).toHaveLength(1)
    expect(hits[0].page).toBeUndefined()
  })

  it('skips empty pages and replaces stale pages on re-index', () => {
    const engine = new SearchEngine()
    engine.indexPdfPages(PDF_PATH, [...PAGES, { page: 4, text: '   ' }])
    expect(engine.size).toBe(3)

    // Re-index with one page of new content: old phrases gone, new found.
    engine.indexPdfPages(PDF_PATH, [{ page: 1, text: 'Entirely rewritten contents.' }])
    expect(engine.size).toBe(1)
    expect(engine.search('luminous archive')).toHaveLength(0)
    expect(engine.search('rewritten')).toHaveLength(1)
  })

  it('clear() drops indexed pdf pages', () => {
    const engine = new SearchEngine()
    engine.indexPdfPages(PDF_PATH, PAGES)
    engine.clear()
    expect(engine.search('luminous')).toHaveLength(0)
    // A fresh index after clear works against clean per-path bookkeeping.
    engine.indexPdfPages(PDF_PATH, PAGES)
    expect(engine.search('luminous')).toHaveLength(1)
  })
})

describe('vault-worker index-pdf round-trip', () => {
  const isSearchResponse = (msg: WorkerMessage): msg is WorkerSearchResponse =>
    msg.type === 'search-results'

  it('indexes pdf pages without posting a graph rebuild, then answers searches with page hints', () => {
    const posts: WorkerMessage[] = []
    const controller = createWorkerController((msg) => posts.push(msg), 0)
    const send = (msg: WorkerInMessage): void => controller.handleMessage(msg)

    send({ type: 'load', files: [] })
    posts.length = 0

    send({ type: 'index-pdf', pdfPath: PDF_PATH, pages: PAGES })
    expect(posts).toHaveLength(0) // no rebuild, no post

    send({ type: 'search', requestId: 11, query: 'luminous archive' })
    const res = posts.find(isSearchResponse)
    expect(res).toBeDefined()
    expect(res?.requestId).toBe(11)
    expect(res?.hits).toHaveLength(1)
    expect(res?.hits[0]).toMatchObject({ path: PDF_PATH, page: 2, title: 'three-page.pdf' })
  })

  it('a full vault reload clears stale pdf docs', () => {
    const posts: WorkerMessage[] = []
    const controller = createWorkerController((msg) => posts.push(msg), 0)
    controller.handleMessage({ type: 'index-pdf', pdfPath: PDF_PATH, pages: PAGES })
    controller.handleMessage({ type: 'load', files: [] })
    posts.length = 0

    controller.handleMessage({ type: 'search', requestId: 1, query: 'luminous' })
    const res = posts.find(isSearchResponse)
    expect(res?.hits).toHaveLength(0)
  })
})
