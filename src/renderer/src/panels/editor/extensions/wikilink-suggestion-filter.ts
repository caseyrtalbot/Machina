import type { Artifact } from '@shared/types'

export const MAX_WIKILINK_SUGGESTIONS = 8

/**
 * Same scoring contract as ConnectionAutocomplete: title/id prefix match (3)
 * beats substring match (2); non-matches drop out for non-empty queries.
 */
function score(title: string, id: string, query: string): number {
  if (query === '') return 0
  const q = query.toLowerCase()
  const t = title.toLowerCase()
  const i = id.toLowerCase()
  if (t.startsWith(q) || i.startsWith(q)) return 3
  if (t.includes(q) || i.includes(q)) return 2
  return 0
}

/**
 * Pure scoring/filtering for the [[ wikilink autocomplete.
 * Empty query returns the most recently modified artifacts.
 */
export function filterWikilinkSuggestions(
  artifacts: readonly Artifact[],
  query: string,
  max: number = MAX_WIKILINK_SUGGESTIONS
): Artifact[] {
  const candidates: { readonly artifact: Artifact; readonly matchScore: number }[] = []

  for (const a of artifacts) {
    const s = score(a.title, a.id, query)
    if (query !== '' && s === 0) continue
    candidates.push({ artifact: a, matchScore: s })
  }

  candidates.sort((a, b) => {
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore
    // Tiebreak by modified desc
    return (b.artifact.modified ?? '').localeCompare(a.artifact.modified ?? '')
  })

  return candidates.slice(0, max).map((c) => c.artifact)
}
