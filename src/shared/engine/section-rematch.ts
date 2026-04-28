import type { SectionMap } from '../cluster-types'

interface RematchResult {
  readonly resolved: SectionMap
  readonly unresolved: readonly string[]
  readonly changed: boolean
}

function currentHeadings(fileContent: string): string[] {
  const out: string[] = []
  for (const line of fileContent.split('\n')) {
    if (line.startsWith('## ')) out.push(line.slice(3).trim())
  }
  return out
}

/**
 * Resolve each cardId in `prior` to a heading in the current file:
 *   1. exact-match pass keeps every heading whose text still exists,
 *   2. when heading counts line up, remaining ids are positionally matched
 *      (interpreting the rename as a 1:1 swap),
 *   3. otherwise, remaining ids become `unresolved` and the caller must
 *      prompt the user to re-attach.
 */
export function rematchSections(fileContent: string, prior: SectionMap): RematchResult {
  const current = currentHeadings(fileContent)
  const currentSet = new Set(current)
  const priorEntries = Object.entries(prior)

  const resolved: Record<string, string> = {}
  const unresolved: string[] = []
  const usedIndices = new Set<number>()

  // Pass 1: exact matches, tie-break by first available occurrence.
  for (const [cardId, heading] of priorEntries) {
    if (!currentSet.has(heading)) continue
    const idx = current.indexOf(heading)
    if (idx === -1 || usedIndices.has(idx)) continue
    resolved[cardId] = heading
    usedIndices.add(idx)
  }

  const countsMatch = current.length === priorEntries.length
  if (!countsMatch) {
    for (const [cardId] of priorEntries) {
      if (!(cardId in resolved)) unresolved.push(cardId)
    }
    return { resolved, unresolved, changed: false }
  }

  // Pass 2: positional rematch for whatever exact match didn't cover.
  let changed = false
  let pos = 0
  for (const [cardId] of priorEntries) {
    if (cardId in resolved) {
      pos++
      continue
    }
    while (pos < current.length && usedIndices.has(pos)) pos++
    if (pos >= current.length) {
      unresolved.push(cardId)
      continue
    }
    resolved[cardId] = current[pos]
    usedIndices.add(pos)
    changed = true
    pos++
  }

  return { resolved, unresolved, changed }
}
