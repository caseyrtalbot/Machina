import { describe, it, expect } from 'vitest'
import { markdownToHtml } from '../../src/renderer/src/panels/canvas/shared/markdown-html'

describe('markdownToHtml', () => {
  it('converts heading markdown to HTML', () => {
    const result = markdownToHtml('# Hello World')
    expect(result).toContain('<h1>')
    expect(result).toContain('Hello World')
  })

  it('converts paragraph text to HTML', () => {
    const result = markdownToHtml('Just a paragraph')
    expect(result).toContain('<p>')
    expect(result).toContain('Just a paragraph')
  })

  it('converts bullet lists to HTML', () => {
    const result = markdownToHtml('- item one\n- item two')
    expect(result).toContain('<ul>')
    expect(result).toContain('<li>')
  })

  it('converts blockquotes to HTML', () => {
    const result = markdownToHtml('> quoted text')
    expect(result).toContain('<blockquote>')
  })

  it('converts code blocks to HTML', () => {
    const result = markdownToHtml('```js\nconst x = 1\n```')
    expect(result).toContain('<pre>')
    expect(result).toContain('<code')
  })

  it('returns empty string for empty input', () => {
    expect(markdownToHtml('')).toBe('')
  })

  it('returns empty string for whitespace-only input', () => {
    expect(markdownToHtml('   ')).toBe('')
  })

  it('is idempotent: same input produces same output', () => {
    const md = '# Title\n\nSome **bold** text'
    const first = markdownToHtml(md)
    const second = markdownToHtml(md)
    expect(first).toBe(second)
  })
})
