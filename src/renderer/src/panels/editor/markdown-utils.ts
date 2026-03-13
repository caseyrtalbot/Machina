/**
 * Markdown preprocessing utilities for the editor.
 * Handles frontmatter extraction and wikilink transformation.
 */

export interface ParsedFrontmatter {
  /** Raw YAML block including delimiters, for lossless round-tripping */
  readonly raw: string
  /** Parsed key-value pairs for display in properties panel */
  readonly data: Readonly<Record<string, string | readonly string[]>>
  /** Document body with frontmatter stripped */
  readonly body: string
}

/**
 * Extract YAML frontmatter from markdown content.
 * Returns parsed data for display and the raw block for lossless re-serialization.
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return { raw: '', data: {}, body: content }
  }

  const endIdx = content.indexOf('\n---', 3)
  if (endIdx === -1) return { raw: '', data: {}, body: content }

  const afterClosing = endIdx + 4 // position after `\n---`
  // Count leading newlines between closing delimiter and body
  const leadingMatch = content.slice(afterClosing).match(/^[\r\n]*/)
  const leadingLen = leadingMatch ? leadingMatch[0].length : 0
  // Raw includes everything up to where body starts (for lossless round-tripping)
  const rawBlock = content.slice(0, afterClosing + leadingLen)
  const yamlContent = content.slice(4, endIdx)
  const body = content.slice(afterClosing + leadingLen)

  const data: Record<string, string | string[]> = {}
  let currentKey: string | null = null
  let currentList: string[] | null = null

  for (const line of yamlContent.split('\n')) {
    const trimmed = line.trimEnd()

    // Array item under a key
    if (/^\s+-\s/.test(trimmed) && currentKey) {
      if (!currentList) currentList = []
      currentList.push(trimmed.replace(/^\s+-\s*/, '').replace(/^['"]|['"]$/g, ''))
      continue
    }

    // Flush pending array
    if (currentKey && currentList) {
      data[currentKey] = currentList
      currentKey = null
      currentList = null
    }

    // Key: value pair
    const match = trimmed.match(/^([\w][\w\s-]*):\s*(.*)$/)
    if (!match) continue

    const [, key, value] = match
    const k = key.trim()

    if (value === '' || value === undefined) {
      // Start of block array or empty value
      currentKey = k
      currentList = []
    } else if (value.startsWith('[') && value.endsWith(']')) {
      // Inline array: [a, b, c]
      data[k] = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
    } else {
      data[k] = value.replace(/^['"]|['"]$/g, '')
    }
  }

  // Flush trailing array
  if (currentKey && currentList) {
    data[currentKey] = currentList
  }

  return { raw: rawBlock, data, body }
}

/**
 * Convert [[wikilinks]] to standard markdown links before Tiptap parsing.
 * Supports [[target]] and [[target|display text]] syntax.
 */
export function preprocessWikilinks(markdown: string): string {
  return markdown.replace(/\[\[([^\]]+)\]\]/g, (_match, inner: string) => {
    const pipeIdx = inner.indexOf('|')
    const target = pipeIdx >= 0 ? inner.slice(0, pipeIdx) : inner
    const display = pipeIdx >= 0 ? inner.slice(pipeIdx + 1) : inner
    return `[${display}](wikilink:${encodeURIComponent(target)})`
  })
}

/**
 * Convert wikilink:-scheme links back to [[wikilink]] syntax on serialize.
 */
export function postprocessWikilinks(markdown: string): string {
  return markdown.replace(/\[([^\]]+)\]\(wikilink:([^)]+)\)/g, (_match, display, encoded) => {
    const target = decodeURIComponent(encoded)
    return display === target ? `[[${target}]]` : `[[${target}|${display}]]`
  })
}

/**
 * Serialize frontmatter data back to a raw YAML block.
 * Only used if the original raw block is unavailable.
 */
export function serializeFrontmatter(data: Record<string, string | readonly string[]>): string {
  const entries = Object.entries(data)
  if (entries.length === 0) return ''

  const lines = entries.map(([key, value]) => {
    if (Array.isArray(value)) {
      if (value.length === 0) return `${key}:`
      return `${key}:\n${value.map((v) => `  - ${v}`).join('\n')}`
    }
    return `${key}: ${value}`
  })

  return `---\n${lines.join('\n')}\n---\n`
}
