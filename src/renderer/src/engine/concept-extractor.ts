const NODE_RE = /<node>([^<]+)<\/node>/g

/**
 * Extract unique concept node targets from markdown body text.
 * Parses `<node>term</node>` inline HTML tags.
 * Returns deduplicated targets normalized by lowercase comparison,
 * preserving the first-seen casing for display.
 */
export function extractConceptNodes(body: string): readonly string[] {
  const seen = new Map<string, string>()

  for (const match of body.matchAll(NODE_RE)) {
    const term = match[1].trim()
    if (!term) continue

    const key = term.toLowerCase()
    if (!seen.has(key)) {
      seen.set(key, term)
    }
  }

  return Array.from(seen.values())
}
