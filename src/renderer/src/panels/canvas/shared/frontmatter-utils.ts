import type { MetadataEntry } from './MetadataGrid'

/** Keys that are internal to the engine and should not appear in the metadata grid. */
const HIDDEN_KEYS = new Set(['id', 'title', 'body', 'concepts'])

/** Preferred display order for known keys. Keys not listed appear after these. */
const KEY_ORDER: readonly string[] = [
  'created',
  'modified',
  'type',
  'author',
  'category',
  'tags',
  'source',
  'url',
  'connections',
  'clusters_with',
  'tensions_with',
  'appears_in',
  'related'
]

function sortKey(key: string): number {
  const idx = KEY_ORDER.indexOf(key.toLowerCase())
  return idx >= 0 ? idx : KEY_ORDER.length
}

function formatValue(value: unknown): string {
  if (value == null) return ''
  if (Array.isArray(value)) return JSON.stringify(value)
  if (value instanceof Date) return value.toISOString().split('T')[0]
  return String(value)
}

/** Convert raw frontmatter into displayable entries, filtering internal keys. */
export function frontmatterToEntries(
  frontmatter: Readonly<Record<string, unknown>>
): readonly MetadataEntry[] {
  const entries: MetadataEntry[] = []

  for (const [key, value] of Object.entries(frontmatter)) {
    if (HIDDEN_KEYS.has(key)) continue
    const formatted = formatValue(value)
    if (!formatted) continue
    entries.push({ key, value: formatted })
  }

  return entries.sort((a, b) => sortKey(a.key) - sortKey(b.key))
}
