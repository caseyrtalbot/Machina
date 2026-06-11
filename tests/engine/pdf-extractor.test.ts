import { describe, it, expect } from 'vitest'
import { assemblePageText, extractPdfPages } from '@shared/engine/pdf-extractor'
import type { PdfDocumentLike, PdfTextItemLike } from '@shared/engine/pdf-extractor'

describe('assemblePageText', () => {
  it('joins items with spaces and turns hasEOL into newlines', () => {
    const items: PdfTextItemLike[] = [
      { str: 'First line', hasEOL: true },
      { str: 'second', hasEOL: false },
      { str: 'line', hasEOL: false }
    ]
    expect(assemblePageText(items)).toBe('First line\nsecond line')
  })

  it('skips marked-content entries that carry no str', () => {
    const items: PdfTextItemLike[] = [
      { str: 'visible' },
      {}, // TextMarkedContent shape: no str
      { str: 'text' }
    ]
    expect(assemblePageText(items)).toBe('visible text')
  })

  it('collapses whitespace runs and trims', () => {
    const items: PdfTextItemLike[] = [
      { str: '  padded   ', hasEOL: true },
      { str: '', hasEOL: true },
      { str: 'tail ' }
    ]
    expect(assemblePageText(items)).toBe('padded\ntail')
  })

  it('returns empty string for no items', () => {
    expect(assemblePageText([])).toBe('')
  })
})

describe('extractPdfPages', () => {
  const fakeDoc = (pages: ReadonlyArray<readonly PdfTextItemLike[]>): PdfDocumentLike => ({
    numPages: pages.length,
    getPage: (pageNumber: number) =>
      Promise.resolve({
        getTextContent: () => Promise.resolve({ items: pages[pageNumber - 1] })
      })
  })

  it('extracts every page in order with 1-based numbering', async () => {
    const doc = fakeDoc([[{ str: 'alpha' }], [{ str: 'beta' }], [{ str: 'gamma' }]])
    const pages = await extractPdfPages(doc)
    expect(pages).toEqual([
      { page: 1, text: 'alpha' },
      { page: 2, text: 'beta' },
      { page: 3, text: 'gamma' }
    ])
  })

  it('keeps empty pages so numbering stays stable', async () => {
    const doc = fakeDoc([[{ str: 'alpha' }], [], [{ str: 'gamma' }]])
    const pages = await extractPdfPages(doc)
    expect(pages.map((p) => p.page)).toEqual([1, 2, 3])
    expect(pages[1].text).toBe('')
  })
})
