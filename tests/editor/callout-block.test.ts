import { describe, it, expect } from 'vitest'

describe('CalloutBlock markdown', () => {
  const getTokenizer = async () => {
    const { CalloutBlock } =
      await import('../../src/renderer/src/panels/editor/extensions/callout-block')
    return (CalloutBlock.config as Record<string, unknown>).markdownTokenizer as {
      name: string
      level: string
      start: (src: string) => number
      tokenize: (
        src: string,
        tokens: unknown,
        lexer: { blockTokens: (src: string) => unknown[] }
      ) =>
        | {
            type: string
            raw: string
            calloutType: string
            calloutTitle: string
            calloutFold: string
            tokens: unknown[]
          }
        | undefined
    }
  }

  const getRenderMarkdown = async () => {
    const { CalloutBlock } =
      await import('../../src/renderer/src/panels/editor/extensions/callout-block')
    return (CalloutBlock.config as Record<string, unknown>).renderMarkdown as (
      node: {
        attrs?: { calloutType?: string; calloutTitle?: string; calloutFold?: string }
        content?: unknown[]
      },
      h: {
        renderChild?: (child: unknown, i: number) => string
        renderChildren: (c: unknown[]) => string
      }
    ) => string
  }

  const mockLexer = { blockTokens: (src: string) => [{ type: 'paragraph', text: src }] }

  describe('tokenizer.start', () => {
    it('finds > [!note] in text', async () => {
      const tokenizer = await getTokenizer()
      expect(tokenizer.start('some text\n> [!note]\n> content')).toBeGreaterThanOrEqual(0)
    })

    it('returns -1 when no callout exists', async () => {
      const tokenizer = await getTokenizer()
      expect(tokenizer.start('> regular blockquote')).toBe(-1)
    })
  })

  describe('tokenizer.tokenize', () => {
    it('parses a note callout', async () => {
      const tokenizer = await getTokenizer()
      const result = tokenizer.tokenize('> [!note]\n> This is a note', {}, mockLexer)
      expect(result).toBeDefined()
      expect(result!.type).toBe('callout')
      expect(result!.calloutType).toBe('note')
    })

    it('parses a warning callout', async () => {
      const tokenizer = await getTokenizer()
      const result = tokenizer.tokenize('> [!warning]\n> Be careful', {}, mockLexer)
      expect(result).toBeDefined()
      expect(result!.calloutType).toBe('warning')
    })

    it('parses a tip callout', async () => {
      const tokenizer = await getTokenizer()
      const result = tokenizer.tokenize('> [!tip]\n> Helpful hint', {}, mockLexer)
      expect(result).toBeDefined()
      expect(result!.calloutType).toBe('tip')
    })

    it('parses an important callout', async () => {
      const tokenizer = await getTokenizer()
      const result = tokenizer.tokenize('> [!important]\n> Critical info', {}, mockLexer)
      expect(result).toBeDefined()
      expect(result!.calloutType).toBe('important')
    })

    it('accepts unknown callout types with neutral styling', async () => {
      const tokenizer = await getTokenizer()
      const result = tokenizer.tokenize('> [!unknown]\n> Content', {}, mockLexer)
      expect(result).toBeDefined()
      expect(result!.calloutType).toBe('unknown')
    })

    it('does not match regular blockquotes', async () => {
      const tokenizer = await getTokenizer()
      const result = tokenizer.tokenize('> Just a regular blockquote', {}, mockLexer)
      expect(result).toBeUndefined()
    })

    it('handles multi-line content', async () => {
      const tokenizer = await getTokenizer()
      const result = tokenizer.tokenize(
        '> [!note]\n> Line one\n> Line two\n> Line three',
        {},
        mockLexer
      )
      expect(result).toBeDefined()
      expect(result!.calloutType).toBe('note')
    })

    it('handles empty callout', async () => {
      const tokenizer = await getTokenizer()
      const result = tokenizer.tokenize('> [!note]\n>', {}, mockLexer)
      expect(result).toBeDefined()
      expect(result!.calloutType).toBe('note')
    })

    it('leaves title and fold empty on a bare callout', async () => {
      const tokenizer = await getTokenizer()
      const result = tokenizer.tokenize('> [!note]\n> Plain body', {}, mockLexer)
      expect(result!.calloutTitle).toBe('')
      expect(result!.calloutFold).toBe('')
    })

    // Real Obsidian sample: https://help.obsidian.md/Editing+and+formatting/Callouts
    it('captures a custom title (Obsidian sample)', async () => {
      const tokenizer = await getTokenizer()
      const src = '> [!tip] Callouts can have custom titles\n> Like this one.'
      const result = tokenizer.tokenize(src, {}, mockLexer)
      expect(result).toBeDefined()
      expect(result!.calloutType).toBe('tip')
      expect(result!.calloutTitle).toBe('Callouts can have custom titles')
      expect(result!.raw).toBe(src)
    })

    it('captures a collapsed fold marker with title (Obsidian sample)', async () => {
      const tokenizer = await getTokenizer()
      const src =
        '> [!faq]- Are callouts foldable?\n> Yes! In a foldable callout, the contents are hidden when the callout is collapsed.'
      const result = tokenizer.tokenize(src, {}, mockLexer)
      expect(result).toBeDefined()
      expect(result!.calloutType).toBe('faq')
      expect(result!.calloutFold).toBe('-')
      expect(result!.calloutTitle).toBe('Are callouts foldable?')
      expect(result!.raw).toBe(src)
    })

    it('captures an expanded fold marker without title', async () => {
      const tokenizer = await getTokenizer()
      const result = tokenizer.tokenize('> [!todo]+\n> Expanded by default', {}, mockLexer)
      expect(result).toBeDefined()
      expect(result!.calloutFold).toBe('+')
      expect(result!.calloutTitle).toBe('')
    })

    it('consumes the entire titled callout so no stray text leaks', async () => {
      const tokenizer = await getTokenizer()
      const src = '> [!warning] Custom title here\n> Body line one\n> Body line two'
      const result = tokenizer.tokenize(src, {}, mockLexer)
      expect(result!.raw).toBe(src)
    })
  })

  describe('renderMarkdown', () => {
    it('renders a note callout', async () => {
      const render = await getRenderMarkdown()
      const node = {
        attrs: { calloutType: 'note' },
        content: [{ type: 'paragraph' }]
      }
      const helpers = {
        renderChild: () => 'Content here',
        renderChildren: () => 'Content here'
      }
      const result = render(node, helpers)
      expect(result).toContain('> [!note]')
      expect(result).toContain('> Content here')
    })

    it('renders empty callout', async () => {
      const render = await getRenderMarkdown()
      const node = { attrs: { calloutType: 'warning' }, content: undefined }
      const helpers = { renderChildren: () => '' }
      const result = render(node, helpers)
      expect(result).toContain('> [!warning]')
    })

    it('re-emits title and fold marker', async () => {
      const render = await getRenderMarkdown()
      const node = {
        attrs: { calloutType: 'faq', calloutTitle: 'Are callouts foldable?', calloutFold: '-' },
        content: [{ type: 'paragraph' }]
      }
      const helpers = {
        renderChild: () => 'Yes!',
        renderChildren: () => 'Yes!'
      }
      const result = render(node, helpers)
      expect(result).toBe('> [!faq]- Are callouts foldable?\n> Yes!')
    })

    it('omits trailing space when title is empty', async () => {
      const render = await getRenderMarkdown()
      const node = {
        attrs: { calloutType: 'note', calloutTitle: '', calloutFold: '' },
        content: [{ type: 'paragraph' }]
      }
      const helpers = { renderChild: () => 'Body', renderChildren: () => 'Body' }
      expect(render(node, helpers)).toBe('> [!note]\n> Body')
    })
  })

  describe('round-trip', () => {
    it('titled foldable callout survives tokenize → render unchanged', async () => {
      const tokenizer = await getTokenizer()
      const render = await getRenderMarkdown()
      const src = '> [!tip]- Callouts can have custom titles\n> Which are preserved on save.'

      const token = tokenizer.tokenize(src, {}, mockLexer)
      expect(token).toBeDefined()

      const node = {
        attrs: {
          calloutType: token!.calloutType,
          calloutTitle: token!.calloutTitle,
          calloutFold: token!.calloutFold
        },
        content: [{ type: 'paragraph' }]
      }
      const helpers = {
        renderChild: () => 'Which are preserved on save.',
        renderChildren: () => 'Which are preserved on save.'
      }
      expect(render(node, helpers)).toBe(src)
    })
  })
})
