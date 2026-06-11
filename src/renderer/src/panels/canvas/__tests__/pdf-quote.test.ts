import { describe, it, expect } from 'vitest'
import { createCanvasNode } from '@shared/canvas-types'
import { buildQuoteContent, createQuoteCard, pdfFileName } from '../pdf-quote'

describe('pdfFileName', () => {
  it('returns the filename segment of a path', () => {
    expect(pdfFileName('/vault/docs/paper.pdf')).toBe('paper.pdf')
  })

  it('falls back to PDF for empty src', () => {
    expect(pdfFileName('')).toBe('PDF')
  })
})

describe('buildQuoteContent', () => {
  it('blockquotes the selection and cites the pdf with a wikilink', () => {
    expect(buildQuoteContent('a key insight', 'paper.pdf')).toBe('> a key insight\n\n[[paper.pdf]]')
  })

  it('blockquotes every line of a multi-line selection', () => {
    expect(buildQuoteContent('line one\nline two', 'paper.pdf')).toBe(
      '> line one\n> line two\n\n[[paper.pdf]]'
    )
  })

  it('adds a page marker when a page number is provided (3.10a seam)', () => {
    expect(buildQuoteContent('quote', 'paper.pdf', 3)).toBe('> quote\n\n[[paper.pdf]] (p. 3)')
  })
})

describe('createQuoteCard', () => {
  const pdfNode = createCanvasNode(
    'pdf',
    { x: 100, y: 50 },
    { metadata: { src: '/vault/docs/paper.pdf', pageCount: 12, currentPage: 1 } }
  )

  it('creates a text card containing the quote and a wikilink to the pdf', () => {
    const { node } = createQuoteCard(pdfNode, 'a key insight')
    expect(node.type).toBe('text')
    expect(node.content).toContain('> a key insight')
    expect(node.content).toContain('[[paper.pdf]]')
  })

  it('positions the quote card to the right of the pdf card', () => {
    const { node } = createQuoteCard(pdfNode, 'q')
    expect(node.position.x).toBeGreaterThan(pdfNode.position.x + pdfNode.size.width)
    expect(node.position.y).toBe(pdfNode.position.y)
  })

  it('links the pdf to the quote card with a connection edge', () => {
    const { node, edge } = createQuoteCard(pdfNode, 'q')
    expect(edge.fromNode).toBe(pdfNode.id)
    expect(edge.toNode).toBe(node.id)
    expect(edge.fromSide).toBe('right')
    expect(edge.toSide).toBe('left')
    expect(edge.kind).toBe('connection')
  })

  it('threads the page number through to the citation', () => {
    const { node } = createQuoteCard(pdfNode, 'q', 7)
    expect(node.content).toContain('[[paper.pdf]] (p. 7)')
  })
})
