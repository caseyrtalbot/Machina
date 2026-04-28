/**
 * Wikilink resolver — multi-strategy resolution for [[wikilink]] targets.
 *
 * Handles Obsidian-style linking conventions:
 * - Simple: [[Note Title]]
 * - Aliased: [[target|display]] (alias stripped before resolution)
 * - Path-based: [[Folder/Sub/Note]]
 * - Heading: [[Note#heading]]
 *
 * Pure functions only. No I/O, no Electron/React dependencies.
 */

interface WikilinkTarget {
  /** The link target without heading/block-ref suffix */
  readonly target: string
  /** Heading anchor from [[Note#heading]] syntax, or null */
  readonly heading: string | null
}

/**
 * Parse a raw wikilink target string, extracting any heading reference.
 *
 * "Note#heading"     → { target: "Note", heading: "heading" }
 * "Folder/Note"      → { target: "Folder/Note", heading: null }
 * "#local-heading"   → { target: "", heading: "local-heading" }
 */
export function parseWikilinkTarget(raw: string): WikilinkTarget {
  const hashIdx = raw.indexOf('#')
  if (hashIdx < 0) return { target: raw, heading: null }
  return {
    target: raw.slice(0, hashIdx),
    heading: raw.slice(hashIdx + 1)
  }
}

/**
 * Extract the filename stem from a path-style target (last segment, no extension).
 * "Caseys-Claude-Code/Claude-Code MOC" → "claude-code moc"
 */
function stemFromTarget(target: string): string {
  const lastSlash = target.lastIndexOf('/')
  const name = lastSlash >= 0 ? target.slice(lastSlash + 1) : target
  return name.replace(/\.md$/i, '').toLowerCase()
}

/** Minimal artifact shape needed for resolution — avoids coupling to full Artifact type. */
interface ResolvableArtifact {
  readonly id: string
  readonly title: string
}

/**
 * Resolve a wikilink target to an artifact ID using multi-strategy matching.
 *
 * Resolution order (first match wins):
 * 1. Exact title match (case-insensitive)
 * 2. Exact ID match (case-insensitive)
 * 3. Filename stem match — extracts last path segment and matches against title/ID
 * 4. Path-ending match — checks if any artifact's file path ends with the target
 *
 * The `#heading` suffix is stripped before matching. Use `parseWikilinkTarget`
 * to access the heading separately.
 *
 * @param rawTarget - The raw wikilink target string (may include #heading)
 * @param artifacts - All artifacts available for matching
 * @param idToPath  - Optional map of artifact ID → file path, enables path-ending match
 */
export function resolveWikilinkTarget(
  rawTarget: string,
  artifacts: readonly ResolvableArtifact[],
  idToPath?: Readonly<Record<string, string>>
): string | null {
  const { target } = parseWikilinkTarget(rawTarget)
  if (!target) return null

  const lower = target.toLowerCase()

  // Strategy 1: Exact title match
  for (const a of artifacts) {
    if (a.title.toLowerCase() === lower) return a.id
  }

  // Strategy 2: Exact ID match
  for (const a of artifacts) {
    if (a.id.toLowerCase() === lower) return a.id
  }

  // Strategy 3: Filename stem match (for path-style targets)
  if (target.includes('/')) {
    const targetStem = stemFromTarget(target)
    for (const a of artifacts) {
      if (a.id.toLowerCase() === targetStem || a.title.toLowerCase() === targetStem) return a.id
    }
  }

  // Strategy 4: Path-ending match
  if (idToPath && target.includes('/')) {
    const suffix = '/' + target.toLowerCase()
    for (const [id, path] of Object.entries(idToPath)) {
      const normalizedPath = path.toLowerCase().replace(/\.md$/i, '')
      if (normalizedPath.endsWith(suffix)) return id
    }
  }

  return null
}

/**
 * Build lookup maps for efficient batch resolution (used by graph-builder).
 * Returns maps for O(1) lookups by lowercase ID, title, and filename stem.
 */
export function buildResolutionMaps(artifacts: readonly ResolvableArtifact[]): {
  readonly byLowerId: ReadonlyMap<string, string>
  readonly byLowerTitle: ReadonlyMap<string, string>
  readonly byLowerStem: ReadonlyMap<string, string>
} {
  const byLowerId = new Map<string, string>()
  const byLowerTitle = new Map<string, string>()
  const byLowerStem = new Map<string, string>()

  for (const a of artifacts) {
    byLowerId.set(a.id.toLowerCase(), a.id)
    byLowerTitle.set(a.title.toLowerCase(), a.id)

    // Index stems from both ID and title so bulk body-link resolution matches
    // editor navigation even when artifact IDs are slugs and titles are note names.
    const stems = [stemFromTarget(a.id), stemFromTarget(a.title)]
    for (const stem of stems) {
      if (!byLowerStem.has(stem)) {
        byLowerStem.set(stem, a.id)
      }
    }
  }

  return { byLowerId, byLowerTitle, byLowerStem }
}

/**
 * Resolve a body wikilink using pre-built lookup maps.
 * Faster than `resolveWikilinkTarget` for bulk resolution in graph building.
 *
 * @param lowerTarget - Already-lowercased wikilink target (as returned by extractBodyWikilinks)
 */
export function resolveBodyLink(
  lowerTarget: string,
  maps: {
    readonly byLowerId: ReadonlyMap<string, string>
    readonly byLowerTitle: ReadonlyMap<string, string>
    readonly byLowerStem: ReadonlyMap<string, string>
  }
): string | null {
  // Exact id match
  const byId = maps.byLowerId.get(lowerTarget)
  if (byId) return byId

  // Exact title match
  const byTitle = maps.byLowerTitle.get(lowerTarget)
  if (byTitle) return byTitle

  // Stem match for path-style targets
  if (lowerTarget.includes('/')) {
    const stem = stemFromTarget(lowerTarget)
    const byStem = maps.byLowerStem.get(stem)
    if (byStem) return byStem
  }

  return null
}
