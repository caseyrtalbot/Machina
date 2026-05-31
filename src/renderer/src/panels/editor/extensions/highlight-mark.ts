import { Mark, mergeAttributes } from '@tiptap/core'
import type { MarkdownTokenizer } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    highlight: {
      setHighlight: () => ReturnType
      unsetHighlight: () => ReturnType
      toggleHighlight: () => ReturnType
    }
  }
}

export const HighlightMark = Mark.create({
  name: 'highlight',

  parseHTML() {
    return [{ tag: 'mark' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'mark',
      mergeAttributes(HTMLAttributes, {
        style:
          'background: rgba(234, 179, 8, 0.15); color: inherit; border-radius: 0; padding: 0 2px'
      }),
      0
    ]
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-h': () => this.editor.commands.toggleMark(this.name)
    }
  },

  addCommands() {
    return {
      setHighlight:
        () =>
        ({ commands }) =>
          commands.setMark(this.name),
      unsetHighlight:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
      toggleHighlight:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name)
    }
  },

  markdownTokenizer: {
    name: 'highlight',
    level: 'inline',
    start(src: string) {
      // Find == but not === (horizontal rule)
      const match = src.match(/==[^=]/)
      return match?.index ?? -1
    },
    tokenize(src: string) {
      // Match ==content== but not ===
      const match = src.match(/^==([^=]+?)==/)
      if (!match) return undefined
      return {
        type: 'highlight',
        raw: match[0],
        content: match[1]
      }
    }
  } satisfies MarkdownTokenizer,

  parseMarkdown(token, helpers) {
    return helpers.applyMark('highlight', [helpers.createTextNode(token.content || '')])
  },

  renderMarkdown(node, h) {
    return `==${h.renderChildren(node)}==`
  }
})
