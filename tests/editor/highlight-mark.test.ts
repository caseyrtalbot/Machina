import { describe, it, expect } from 'vitest'

describe('HighlightMark markdown', () => {
  const getTokenizer = async () => {
    const { HighlightMark } =
      await import('../../src/renderer/src/panels/editor/extensions/highlight-mark')
    return (HighlightMark.config as Record<string, unknown>).markdownTokenizer as {
      name: string
      level: string
      start: (src: string) => number
      tokenize: (src: string) => { type: string; raw: string; content: string } | undefined
    }
  }

  const getRenderMarkdown = async () => {
    const { HighlightMark } =
      await import('../../src/renderer/src/panels/editor/extensions/highlight-mark')
    return (HighlightMark.config as Record<string, unknown>).renderMarkdown as (
      node: unknown,
      h: { renderChildren: (node: unknown) => string }
    ) => string
  }

  describe('tokenizer.start', () => {
    it('finds == in text', async () => {
      const tokenizer = await getTokenizer()
      expect(tokenizer.start('hello ==highlighted== world')).toBe(6)
    })

    it('returns -1 when no highlight exists', async () => {
      const tokenizer = await getTokenizer()
      expect(tokenizer.start('no highlights here')).toBe(-1)
    })

    it('does not match === (horizontal rule)', async () => {
      const tokenizer = await getTokenizer()
      // === has no non-= char after ==, so start() should return -1
      expect(tokenizer.start('===')).toBe(-1)
    })
  })

  describe('tokenizer.tokenize', () => {
    it('extracts highlighted text', async () => {
      const tokenizer = await getTokenizer()
      const result = tokenizer.tokenize('==important text== rest')
      expect(result).toEqual({
        type: 'highlight',
        raw: '==important text==',
        content: 'important text'
      })
    })

    it('returns undefined for non-matching input', async () => {
      const tokenizer = await getTokenizer()
      expect(tokenizer.tokenize('no highlights')).toBeUndefined()
    })

    it('handles single word highlight', async () => {
      const tokenizer = await getTokenizer()
      const result = tokenizer.tokenize('==word==')
      expect(result).toBeDefined()
      expect(result!.content).toBe('word')
    })

    it('does not match empty highlight ==== ', async () => {
      const tokenizer = await getTokenizer()
      // ==== has no content between the markers
      expect(tokenizer.tokenize('====')).toBeUndefined()
    })
  })

  describe('renderMarkdown', () => {
    it('wraps children in == markers', async () => {
      const render = await getRenderMarkdown()
      const mockHelpers = { renderChildren: () => 'highlighted' }
      expect(render({}, mockHelpers)).toBe('==highlighted==')
    })
  })
})
