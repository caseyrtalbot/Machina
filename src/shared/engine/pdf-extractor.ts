/**
 * PDF per-page text extraction (3.10a).
 *
 * Engine kernel — pure, zero imports. The *Like interfaces below are
 * structural subsets of pdfjs-dist's TextItem / TextContent / PDFPageProxy /
 * PDFDocumentProxy, so a real pdfjs document satisfies PdfDocumentLike at the
 * call boundary without this module depending on pdfjs.
 */

/**
 * Structural subset of pdfjs `TextItem | TextMarkedContent`. Marked-content
 * entries carry a `type` but no `str`; `type` is declared here only so the
 * union overlaps this weak type and assembly can skip those entries.
 */
export interface PdfTextItemLike {
  readonly str?: string
  readonly hasEOL?: boolean
  readonly type?: string
}

export interface PdfTextContentLike {
  readonly items: readonly PdfTextItemLike[]
}

export interface PdfPageLike {
  getTextContent(): Promise<PdfTextContentLike>
}

export interface PdfDocumentLike {
  readonly numPages: number
  getPage(pageNumber: number): Promise<PdfPageLike>
}

/** One page's assembled text. `page` is 1-based, matching pdfjs numbering. */
export interface PdfPageText {
  readonly page: number
  readonly text: string
}

/**
 * Assemble one page's text from pdfjs text-content items: items joined with
 * spaces, `hasEOL` becomes a newline, whitespace runs collapsed. Marked-content
 * entries (no `str`) are skipped.
 */
export function assemblePageText(items: readonly PdfTextItemLike[]): string {
  let out = ''
  for (const item of items) {
    if (typeof item.str !== 'string') continue
    out += item.str
    out += item.hasEOL ? '\n' : ' '
  }
  return out
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

/**
 * Extract every page's text in order. Pages with no text come back with an
 * empty string so callers keep stable 1-based numbering. Errors propagate;
 * indexing callers treat extraction as best-effort and catch.
 */
export async function extractPdfPages(doc: PdfDocumentLike): Promise<PdfPageText[]> {
  const pages: PdfPageText[] = []
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber)
    const content = await page.getTextContent()
    pages.push({ page: pageNumber, text: assemblePageText(content.items) })
  }
  return pages
}
