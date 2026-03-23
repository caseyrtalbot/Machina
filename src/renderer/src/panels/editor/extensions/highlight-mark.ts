import { Mark, mergeAttributes } from '@tiptap/core'
import type { MarkdownTokenizer } from '@tiptap/core'

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
          'background: rgba(234, 179, 8, 0.15); color: inherit; border-radius: 2px; padding: 0 2px'
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
        ({ commands }: { commands: any }) =>
          commands.setMark(this.name),
      unsetHighlight:
        () =>
        ({ commands }: { commands: any }) =>
          commands.unsetMark(this.name),
      toggleHighlight:
        () =>
        ({ commands }: { commands: any }) =>
          commands.toggleMark(this.name)
    } as any
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

  parseMarkdown(token: any, helpers: any) {
    return helpers.applyMark('highlight', [helpers.createTextNode(token.content || '')])
  },

  renderMarkdown(node: any, h: any) {
    return `==${h.renderChildren(node)}==`
  }
})
