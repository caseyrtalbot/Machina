const WIKILINK_RE = /\[\[([^\]]+)\]\]/g

/**
 * Extract unique wikilink targets from markdown body text.
 * Handles both [[target]] and [[target|display]] syntax.
 * Returns deduplicated targets normalized by lowercase comparison.
 */
export function extractWikilinks(body: string): readonly string[] {
  const seen = new Map<string, string>()

  for (const match of body.matchAll(WIKILINK_RE)) {
    const inner = match[1]
    const pipeIdx = inner.indexOf('|')
    const target = pipeIdx >= 0 ? inner.slice(0, pipeIdx) : inner
    const trimmed = target.trim()
    if (trimmed.length === 0) continue

    const key = trimmed.toLowerCase()
    if (!seen.has(key)) {
      seen.set(key, trimmed)
    }
  }

  return Array.from(seen.values())
}
