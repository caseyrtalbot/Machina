import {
  createCanvasNode,
  createCanvasEdge,
  type CanvasNode,
  type CanvasEdge
} from '@shared/canvas-types'

/** Horizontal gap between the PDF card and the quote card it spawns. */
const QUOTE_CARD_GAP = 60

/** Filename of the PDF, used as the wikilink target. */
export function pdfFileName(src: string): string {
  const segments = src.split('/')
  return segments[segments.length - 1] || 'PDF'
}

/**
 * Build the quote-card markdown: blockquoted selection plus a wikilink back
 * to the PDF. `page` is the seam for 3.10a page-number hints — when provided
 * the citation gains a page marker.
 */
export function buildQuoteContent(quote: string, pdfName: string, page?: number): string {
  const quoted = quote
    .trim()
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
  const cite = page !== undefined ? `[[${pdfName}]] (p. ${page})` : `[[${pdfName}]]`
  return `${quoted}\n\n${cite}`
}

/**
 * Create a text card holding the quote, positioned to the right of the PDF
 * card, plus a connection edge linking the two.
 */
export function createQuoteCard(
  pdfNode: CanvasNode,
  quote: string,
  page?: number
): { node: CanvasNode; edge: CanvasEdge } {
  const src = typeof pdfNode.metadata.src === 'string' ? pdfNode.metadata.src : ''
  const content = buildQuoteContent(quote, pdfFileName(src), page)
  const position = {
    x: pdfNode.position.x + pdfNode.size.width + QUOTE_CARD_GAP,
    y: pdfNode.position.y
  }
  const node = createCanvasNode('text', position, { content })
  const edge = createCanvasEdge(pdfNode.id, node.id, 'right', 'left', 'connection')
  return { node, edge }
}
