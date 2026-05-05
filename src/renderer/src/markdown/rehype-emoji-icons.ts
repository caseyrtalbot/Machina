import type { Root, Element, Text, RootContent, ElementContent } from 'hast'
import { visit, SKIP } from 'unist-util-visit'
import { EMOJI_PATTERN, lookupLucideName } from './emoji-icon-map'

/**
 * Rehype plugin: walks text nodes, splits each on emoji clusters, and
 * replaces mapped emojis with `<span data-lucide-icon="Name" />` markers.
 * Unmapped emojis are left untouched. The renderer (ThreadMessage) maps
 * `span[data-lucide-icon]` to the corresponding Lucide React component.
 *
 * Skips text inside `<code>` and `<pre>` so code samples stay verbatim.
 */
export function rehypeEmojiIcons() {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || index == null) return
      if (parent.type === 'element') {
        const tag = (parent as Element).tagName
        if (tag === 'code' || tag === 'pre' || tag === 'style' || tag === 'script') {
          return
        }
      }
      const value = node.value
      if (!value || !EMOJI_PATTERN.test(value)) return
      EMOJI_PATTERN.lastIndex = 0
      const next: ElementContent[] = []
      let cursor = 0
      let match: RegExpExecArray | null
      while ((match = EMOJI_PATTERN.exec(value)) !== null) {
        const cluster = match[0]
        const start = match.index
        const lucide = lookupLucideName(cluster)
        if (start > cursor) {
          next.push({ type: 'text', value: value.slice(cursor, start) } as Text)
        }
        if (lucide) {
          next.push({
            type: 'element',
            tagName: 'span',
            properties: { dataLucideIcon: lucide },
            children: []
          } as Element)
        } else {
          next.push({ type: 'text', value: cluster } as Text)
        }
        cursor = start + cluster.length
      }
      if (cursor < value.length) {
        next.push({ type: 'text', value: value.slice(cursor) } as Text)
      }
      const parentChildren = parent.children as RootContent[]
      parentChildren.splice(index, 1, ...(next as RootContent[]))
      return [SKIP, index + next.length]
    })
  }
}
