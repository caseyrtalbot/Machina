// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { extractPdfPages } from '@shared/engine/pdf-extractor'
import type { PdfDocumentLike } from '@shared/engine/pdf-extractor'
import { SearchEngine } from '@shared/engine/search-engine'
import { buildThreePagePdf, PAGE_TEXTS } from '../fixtures/three-page-pdf'

/**
 * End-to-end over real pdfjs (legacy build runs in Node): the hand-written
 * 3-page fixture PDF round-trips through extractPdfPages into the SearchEngine,
 * and a page-2 phrase comes back with its page hint — the 3.10a spec test.
 */

interface PdfjsLegacyModule {
  getDocument: (params: { data: Uint8Array; verbosity?: number }) => {
    promise: Promise<PdfDocumentLike & { destroy: () => Promise<void> }>
  }
}

async function loadFixtureDoc(): Promise<PdfDocumentLike & { destroy: () => Promise<void> }> {
  const pdfjs = (await import(
    // @ts-expect-error -- deep import of the Node-compatible legacy build; no bundled types
    'pdfjs-dist/legacy/build/pdf.mjs'
  )) as PdfjsLegacyModule
  return pdfjs.getDocument({ data: buildThreePagePdf(), verbosity: 0 }).promise
}

describe('pdf extraction through real pdfjs', () => {
  it('extracts the three fixture pages with their text', async () => {
    const doc = await loadFixtureDoc()
    try {
      const pages = await extractPdfPages(doc)
      expect(pages.map((p) => p.page)).toEqual([1, 2, 3])
      expect(pages.map((p) => p.text)).toEqual([...PAGE_TEXTS])
    } finally {
      await doc.destroy()
    }
  })

  it('search finds the page-2 phrase with a page hint', async () => {
    const doc = await loadFixtureDoc()
    try {
      const pages = await extractPdfPages(doc)
      const engine = new SearchEngine()
      engine.indexPdfPages('/vault/papers/three-page.pdf', pages)

      const hits = engine.search('luminous archive')
      expect(hits).toHaveLength(1)
      expect(hits[0].page).toBe(2)
      expect(hits[0].path).toBe('/vault/papers/three-page.pdf')
      expect(hits[0].snippet).toContain('luminous archive sits quietly on page two')
    } finally {
      await doc.destroy()
    }
  })
})
