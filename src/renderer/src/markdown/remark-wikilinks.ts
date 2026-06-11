/**
 * Remark plugin: parse Obsidian-style [[target]] / [[target|alias]] wikilinks
 * in chat markdown into link nodes that ThreadMessage renders as clickable
 * note references. Code blocks and inline code are untouched (their content
 * never appears as mdast `text` nodes).
 */

const WIKILINK_RE = /\[\[([^\][|]+)(?:\|([^\][]+))?\]\]/g

interface MdNode {
  type: string
  value?: string
  url?: string
  children?: MdNode[]
  data?: { hProperties?: Record<string, string> }
}

function splitTextNode(node: MdNode): MdNode[] | null {
  const value = node.value ?? ''
  WIKILINK_RE.lastIndex = 0
  if (!WIKILINK_RE.test(value)) return null
  WIKILINK_RE.lastIndex = 0

  const out: MdNode[] = []
  let last = 0
  for (const match of value.matchAll(WIKILINK_RE)) {
    const idx = match.index ?? 0
    if (idx > last) out.push({ type: 'text', value: value.slice(last, idx) })
    const target = match[1].trim()
    const display = (match[2] ?? match[1]).trim()
    out.push({
      type: 'link',
      url: '#wikilink',
      data: { hProperties: { 'data-wikilink-target': target } },
      children: [{ type: 'text', value: display }]
    })
    last = idx + match[0].length
  }
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) })
  return out
}

function walk(node: MdNode): void {
  const children = node.children
  if (!children) return
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i]
    // Don't rewrite text inside an existing link — nested anchors are invalid.
    if (child.type === 'text' && node.type !== 'link') {
      const replacement = splitTextNode(child)
      if (replacement) children.splice(i, 1, ...replacement)
    } else {
      walk(child)
    }
  }
}

export function remarkWikilinks() {
  return (tree: unknown): void => {
    walk(tree as MdNode)
  }
}
