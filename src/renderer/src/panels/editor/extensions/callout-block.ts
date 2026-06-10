import { Node, mergeAttributes } from '@tiptap/core'
import type { MarkdownTokenizer, MarkdownToken } from '@tiptap/core'
import { colors, type CalloutPaletteKey } from '@renderer/design/tokens'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (calloutType?: string) => ReturnType
      toggleCallout: (calloutType?: string) => ReturnType
    }
  }
}

// Map every supported callout kind to one of the six palette slots in
// `colors.callout`. Unknown kinds fall through to `muted`.
const CALLOUT_PALETTE: Record<string, CalloutPaletteKey> = {
  // Info (blue)
  note: 'info',
  info: 'info',
  abstract: 'info',
  summary: 'info',
  tldr: 'info',
  // Success (green)
  tip: 'success',
  success: 'success',
  check: 'success',
  done: 'success',
  hint: 'success',
  // Warning (amber)
  warning: 'warning',
  caution: 'warning',
  attention: 'warning',
  // Danger (red)
  danger: 'danger',
  error: 'danger',
  fail: 'danger',
  failure: 'danger',
  missing: 'danger',
  bug: 'danger',
  // Important (purple)
  important: 'important',
  question: 'important',
  help: 'important',
  faq: 'important',
  // Muted (neutral gray)
  example: 'muted',
  quote: 'muted',
  cite: 'muted',
  todo: 'muted'
}

function getCalloutStyle(type: string): { bg: string; border: string } {
  return colors.callout[CALLOUT_PALETTE[type] ?? 'muted']
}

export const CalloutBlock = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',

  defining: true,

  addAttributes() {
    return {
      calloutType: {
        default: 'note',
        parseHTML: (element) => element.getAttribute('data-callout-type') || 'note',
        renderHTML: (attributes) => ({ 'data-callout-type': attributes.calloutType })
      },
      // Optional Obsidian title text after the marker: > [!tip] Custom title
      calloutTitle: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-callout-title') ?? '',
        renderHTML: (attributes) =>
          attributes.calloutTitle ? { 'data-callout-title': attributes.calloutTitle } : {}
      },
      // Obsidian fold marker: '+' (expanded) or '-' (collapsed). Preserved
      // for round-tripping; no folding UI yet.
      calloutFold: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-callout-fold') ?? '',
        renderHTML: (attributes) =>
          attributes.calloutFold ? { 'data-callout-fold': attributes.calloutFold } : {}
      }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-callout-type]' }]
  },

  renderHTML({ HTMLAttributes }) {
    const type = (HTMLAttributes['data-callout-type'] as string) || 'note'
    const title = (HTMLAttributes['data-callout-title'] as string) || type
    const style = getCalloutStyle(type)

    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-callout-type': type,
        style: [
          `background: ${style.bg}`,
          `border-left: 3px solid ${style.border}`,
          'border-radius: 0',
          'padding: 12px 16px',
          'margin: 8px 0'
        ].join('; ')
      }),
      [
        'div',
        {
          style: [
            `color: ${style.border}`,
            'font-size: 11px',
            'font-weight: 600',
            'text-transform: uppercase',
            'letter-spacing: 0.05em',
            'margin-bottom: 6px'
          ].join('; ')
        },
        title
      ],
      ['div', {}, 0]
    ]
  },

  addCommands() {
    return {
      setCallout:
        (calloutType = 'note') =>
        ({ commands }) =>
          commands.wrapIn(this.name, { calloutType }),
      toggleCallout:
        (calloutType = 'note') =>
        ({ commands }) => {
          if (this.editor.isActive(this.name)) {
            return commands.lift(this.name)
          }
          return commands.wrapIn(this.name, { calloutType })
        }
    }
  },

  // Custom tokenizer: intercept > [!TYPE] before the standard blockquote tokenizer
  markdownTokenizer: {
    name: 'callout',
    level: 'block',
    start(src: string) {
      const match = src.match(/^> \[!(\w+)\]/m)
      return match?.index ?? -1
    },
    tokenize(
      src: string,
      _tokens: MarkdownToken[],
      lexer: { blockTokens: (src: string) => MarkdownToken[] }
    ) {
      // Match > [!TYPE][+-]? optional title, then continuation lines starting with >
      const match = src.match(/^> \[!(\w+)\]([+-]?) ?([^\n]*)(?:\n((?:> ?[^\n]*(?:\n|$))*))?/)
      if (!match) return undefined

      const rawType = match[1].toLowerCase()
      const fold = match[2]
      const title = match[3].trim()

      // Strip the > prefix from each content line
      const contentLines = (match[4] ?? '')
        .split('\n')
        .filter((line) => line.startsWith('>'))
        .map((line) => line.replace(/^> ?/, ''))

      const content = contentLines.join('\n').trim()

      // Parse the inner content as blocks
      const tokens = content ? lexer.blockTokens(content) : []

      return {
        type: 'callout',
        raw: match[0],
        calloutType: rawType,
        calloutTitle: title,
        calloutFold: fold,
        tokens
      }
    }
  } satisfies MarkdownTokenizer,

  parseMarkdown(token: MarkdownToken, helpers) {
    const parseBlockChildren = helpers.parseBlockChildren ?? helpers.parseChildren
    const calloutToken = token as MarkdownToken & {
      calloutType?: string
      calloutTitle?: string
      calloutFold?: string
    }
    return helpers.createNode(
      'callout',
      {
        calloutType: calloutToken.calloutType || 'note',
        calloutTitle: calloutToken.calloutTitle ?? '',
        calloutFold: calloutToken.calloutFold ?? ''
      },
      parseBlockChildren(token.tokens || [])
    )
  },

  renderMarkdown(node, h) {
    const attrs = (node.attrs ?? {}) as Record<string, string>
    const type = attrs.calloutType || 'note'
    const fold = attrs.calloutFold || ''
    const title = attrs.calloutTitle ? ` ${attrs.calloutTitle}` : ''
    const header = `> [!${type}]${fold}${title}`

    if (!node.content) {
      return `${header}\n>`
    }

    const prefix = '>'
    const result: string[] = []

    node.content.forEach((child: { type?: string }, index: number) => {
      const childContent = h.renderChild?.(child, index) ?? h.renderChildren([child])
      const lines = childContent.split('\n')
      const linesWithPrefix = lines.map((line: string) =>
        line.trim() === '' ? prefix : `${prefix} ${line}`
      )
      result.push(linesWithPrefix.join('\n'))
    })

    return `${header}\n${result.join(`\n${prefix}\n`)}`
  }
})
