/**
 * Unlinked mentions — find plain-text occurrences of a note's title/id in
 * another note's content, excluding occurrences that are already linked
 * ([[wikilinks]]), inside code (fences or inline spans), inside YAML
 * frontmatter, or inside <node> concept tags.
 *
 * Pure functions only. No I/O, no Electron/React dependencies.
 */

export interface MentionMatch {
  /** Offset of the match in the scanned content. */
  readonly index: number
  /** Length of the matched text. */
  readonly length: number
}

/** Terms shorter than this are skipped — single characters are pure noise. */
const MIN_TERM_LENGTH = 2

const WORD_CHAR = /[A-Za-z0-9_]/

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Ranges of content where mentions must not be detected or linkified:
 * YAML frontmatter, ``` code fences (unclosed fence runs to end of content),
 * inline `code` spans, existing [[wikilinks]], and <node> concept tags.
 */
function excludedRanges(content: string): ReadonlyArray<readonly [number, number]> {
  const ranges: Array<readonly [number, number]> = []

  const frontmatter = content.match(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/)
  if (frontmatter) ranges.push([0, frontmatter[0].length])

  const patterns = [
    /```[\s\S]*?(?:```|$)/g, // fenced code blocks
    /`[^`\n]*`/g, // inline code spans
    /\[\[[^\]\n]*\]\]/g, // wikilinks (incl. [[target|alias]])
    /<node>[\s\S]*?<\/node>/gi // concept tags — already a connection
  ]
  for (const pattern of patterns) {
    for (const m of content.matchAll(pattern)) {
      ranges.push([m.index, m.index + m[0].length])
    }
  }
  return ranges
}

/**
 * Find whole-word, case-insensitive occurrences of any term in content.
 * Matches are non-overlapping; longer terms win at the same position.
 */
export function findMentions(content: string, terms: readonly string[]): MentionMatch[] {
  const usable = [...new Set(terms.map((t) => t.trim()).filter((t) => t.length >= MIN_TERM_LENGTH))]
  if (usable.length === 0 || content.length === 0) return []

  // Longest-first so the longer alternative wins when terms share a prefix.
  const pattern = usable
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|')
  const excluded = excludedRanges(content)
  const matches: MentionMatch[] = []

  for (const m of content.matchAll(new RegExp(pattern, 'gi'))) {
    const start = m.index
    const end = start + m[0].length
    const before = content[start - 1]
    const after = content[end]
    if (before !== undefined && WORD_CHAR.test(before)) continue
    if (after !== undefined && WORD_CHAR.test(after)) continue
    if (excluded.some(([s, e]) => start >= s && end <= e)) continue
    matches.push({ index: start, length: m[0].length })
  }
  return matches
}

/**
 * Wrap every unlinked mention of the terms in [[...]], preserving the
 * original casing of the matched text (wikilink resolution is
 * case-insensitive, see wikilink-resolver.ts). Returns the original content
 * unchanged when nothing matched.
 */
export function linkifyMentions(
  content: string,
  terms: readonly string[]
): { readonly content: string; readonly count: number } {
  const matches = findMentions(content, terms)
  if (matches.length === 0) return { content, count: 0 }

  let result = ''
  let cursor = 0
  for (const m of matches) {
    const matched = content.slice(m.index, m.index + m.length)
    result += `${content.slice(cursor, m.index)}[[${matched}]]`
    cursor = m.index + m.length
  }
  result += content.slice(cursor)
  return { content: result, count: matches.length }
}
