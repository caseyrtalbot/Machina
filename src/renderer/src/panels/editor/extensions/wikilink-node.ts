import { Node, mergeAttributes } from '@tiptap/core'
import type { MarkdownTokenizer, MarkdownToken } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

interface WikilinkNodeOptions {
  HTMLAttributes: Record<string, unknown>
  onNavigate?: (target: string) => void
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    wikilinkNode: {
      insertWikilink: (target: string, alias?: string) => ReturnType
    }
  }
}

export const WikilinkNode = Node.create<WikilinkNodeOptions>({
  name: 'wikilink',
  group: 'inline',
  inline: true,
  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      onNavigate: undefined
    }
  },

  addAttributes() {
    return {
      target: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-wikilink-target') ?? element.textContent,
        renderHTML: (attributes) => ({ 'data-wikilink-target': attributes.target as string })
      },
      alias: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-wikilink-alias') || null,
        renderHTML: (attributes) => {
          if (!attributes.alias) return {}
          return { 'data-wikilink-alias': attributes.alias as string }
        }
      }
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-wikilink-target]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const target = node.attrs.target as string
    const alias = node.attrs.alias as string | null
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-wikilink-target': target,
        class: 'te-wikilink',
        style:
          'color: var(--color-accent-default); cursor: pointer; background: rgba(255,255,255,0.04); padding: 1px 4px; border-radius: 0;'
      }),
      alias ?? target
    ]
  },

  renderText({ node }) {
    const alias = node.attrs.alias as string | null
    return alias ? `[[${node.attrs.target}|${alias}]]` : `[[${node.attrs.target}]]`
  },

  addCommands() {
    return {
      insertWikilink:
        (target: string, alias?: string) =>
        ({ chain }) =>
          chain()
            .insertContent({
              type: this.name,
              attrs: { target, alias: alias ?? null }
            })
            .run()
    }
  },

  addProseMirrorPlugins() {
    const onNavigate = this.options.onNavigate
    if (!onNavigate) return []

    return [
      new Plugin({
        key: new PluginKey('wikilinkClick'),
        props: {
          handleClick: (view, pos, event) => {
            if (!event.metaKey) return false
            const node = view.state.doc.nodeAt(pos)
            if (node?.type.name !== 'wikilink') return false
            const target = node.attrs.target as string
            if (target) {
              event.preventDefault()
              onNavigate(target)
              return true
            }
            return false
          }
        }
      })
    ]
  },

  // Markdown serialization for [[wikilink]] syntax
  markdownTokenizer: {
    name: 'wikilink',
    level: 'inline',
    start(src: string) {
      const idx = src.indexOf('[[')
      return idx >= 0 ? idx : -1
    },
    tokenize(src: string) {
      const match = src.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/)
      if (!match) return undefined
      return {
        type: 'wikilink',
        raw: match[0],
        content: match[1],
        alias: match[2] || null
      }
    }
  } satisfies MarkdownTokenizer,

  parseMarkdown(token) {
    return {
      type: 'wikilink',
      attrs: {
        target: token.content || '',
        alias: (token as MarkdownToken & { alias?: string | null }).alias ?? null
      }
    }
  },

  renderMarkdown(node) {
    const target = node.attrs?.target ?? ''
    const alias = node.attrs?.alias as string | null
    return alias ? `[[${target}|${alias}]]` : `[[${target}]]`
  }
})
