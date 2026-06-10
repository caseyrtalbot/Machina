const NODE_RE = /<node>([^<]+)<\/node>/g

/**
 * Strip fenced code blocks (``` or ~~~) and inline `code` spans from markdown.
 * Shared by wikilink and concept extraction so links/tags inside code samples
 * never create graph edges or concepts.
 */
export function stripCode(body: string): string {
  const lines = body.split('\n')
  const kept: string[] = []
  let fence: string | null = null
  for (const line of lines) {
    const m = /^\s{0,3}(```|~~~)/.exec(line)
    if (m) {
      if (fence === null) fence = m[1]
      else if (m[1] === fence) fence = null
      continue
    }
    if (fence === null) kept.push(line)
  }
  return kept.join('\n').replace(/`[^`\n]*`/g, '')
}

/**
 * Extract unique concept node targets from markdown body text.
 * Parses `<node>term</node>` inline HTML tags. Code blocks/spans are
 * stripped first so code samples never produce concepts.
 * Returns deduplicated targets normalized by lowercase comparison,
 * preserving the first-seen casing for display.
 */
export function extractConceptNodes(body: string): readonly string[] {
  const seen = new Map<string, string>()

  for (const match of stripCode(body).matchAll(NODE_RE)) {
    const term = match[1].trim()
    if (!term) continue

    const key = term.toLowerCase()
    if (!seen.has(key)) {
      seen.set(key, term)
    }
  }

  return Array.from(seen.values())
}
