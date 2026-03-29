/**
 * Ghost index — identifies unresolved [[wikilink]] references (ghost nodes)
 * and extracts sentence-level context from the files that reference them.
 *
 * Pure functions only. No I/O.
 */

import type { KnowledgeGraph, Artifact } from '@shared/types'

export interface GhostReference {
  readonly filePath: string
  readonly fileTitle: string
  readonly context: string
}

export interface GhostEntry {
  readonly id: string
  readonly referenceCount: number
  readonly references: readonly GhostReference[]
}

/**
 * Returns true if a ghost ID looks like a folder path rather than an idea reference.
 * Path-based wikilinks (e.g. "Naval's Library/Themes/Radical Truth") are structural
 * navigation, not intellectual gaps worth triaging.
 */
export function isPathGhost(id: string): boolean {
  return id.includes('/')
}

/**
 * Strip [[wikilink]] syntax from a context snippet, keeping the display text readable.
 * "see [[Naval's Library/Themes/Truth|Truth]] for" → "see Truth for"
 * "Author: [[Richard Hamming]]" → "Author: Richard Hamming"
 */
export function stripWikilinksFromContext(text: string): string {
  return text.replace(/\[\[([^\]|]*?)(?:\|([^\]]*?))?\]\]/g, (_match, target, alias) => {
    if (alias) return alias
    // For path-style targets, use the last segment
    const lastSlash = target.lastIndexOf('/')
    return lastSlash >= 0 ? target.slice(lastSlash + 1) : target
  })
}

/**
 * Extract ~100 characters of context around a [[wikilink]] match in body text.
 * Returns a clean, readable sentence fragment with wikilink syntax stripped.
 */
export function extractContext(body: string, targetId: string): string | null {
  const re = new RegExp(`\\[\\[${escapeRegex(targetId)}(?:\\|[^\\]]+)?\\]\\]`)
  const match = re.exec(body)
  if (!match) return null

  const start = Math.max(0, match.index - 50)
  const end = Math.min(body.length, match.index + match[0].length + 50)
  let snippet = body.slice(start, end).replace(/\n/g, ' ').trim()

  if (start > 0) snippet = '...' + snippet
  if (end < body.length) snippet = snippet + '...'

  return stripWikilinksFromContext(snippet)
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Build the ghost index from the knowledge graph and parsed artifacts.
 *
 * Ghost nodes are graph nodes with no `path` (no backing .md file).
 * For each ghost, collects all referencing artifacts with sentence context.
 *
 * Filters out path-based ghosts (containing '/') which are structural
 * navigation wikilinks, not intellectual gaps worth triaging.
 *
 * Returns sorted by reference count (most-referenced first).
 */
export function buildGhostIndex(
  graph: KnowledgeGraph,
  artifacts: readonly Artifact[]
): readonly GhostEntry[] {
  const ghostIds = new Set<string>()
  for (const node of graph.nodes) {
    if (!node.path && !isPathGhost(node.id)) ghostIds.add(node.id)
  }

  if (ghostIds.size === 0) return []

  // Build reverse edge map: ghost ID -> source artifact IDs
  const reverseEdges = new Map<string, Set<string>>()
  for (const edge of graph.edges) {
    if (ghostIds.has(edge.target)) {
      const sources = reverseEdges.get(edge.target)
      if (sources) {
        sources.add(edge.source)
      } else {
        reverseEdges.set(edge.target, new Set([edge.source]))
      }
    }
    // Also check source side (edges can be bidirectional in co-occurrence)
    if (ghostIds.has(edge.source)) {
      const sources = reverseEdges.get(edge.source)
      if (sources) {
        sources.add(edge.target)
      } else {
        reverseEdges.set(edge.source, new Set([edge.target]))
      }
    }
  }

  const artifactById = new Map<string, Artifact>()
  for (const a of artifacts) {
    artifactById.set(a.id, a)
  }

  const entries: GhostEntry[] = []

  for (const ghostId of ghostIds) {
    const sourceIds = reverseEdges.get(ghostId)
    if (!sourceIds || sourceIds.size === 0) continue

    const references: GhostReference[] = []
    for (const srcId of sourceIds) {
      const artifact = artifactById.get(srcId)
      if (!artifact) continue

      // Check body for wikilink context
      const context = extractContext(artifact.body, ghostId)
      // Also check frontmatter relationship arrays
      const inFrontmatter =
        artifact.connections.includes(ghostId) ||
        artifact.clusters_with.includes(ghostId) ||
        artifact.tensions_with.includes(ghostId) ||
        artifact.appears_in.includes(ghostId) ||
        artifact.related.includes(ghostId)

      const displayContext =
        context ?? (inFrontmatter ? `Referenced in frontmatter of "${artifact.title}"` : null)
      if (!displayContext) continue

      references.push({
        filePath: ghostId,
        fileTitle: artifact.title,
        context: displayContext
      })
    }

    if (references.length > 0) {
      entries.push({
        id: ghostId,
        referenceCount: references.length,
        references
      })
    }
  }

  return entries.sort((a, b) => b.referenceCount - a.referenceCount)
}

/**
 * Infer the best folder for creating a file from a ghost node.
 *
 * Looks at the folders of referencing files. If >50% are in the same
 * subfolder, suggests that subfolder. Otherwise returns the vault root.
 */
export function inferFolder(
  _ghostId: string,
  referencePaths: readonly string[],
  vaultPath: string
): string {
  if (referencePaths.length === 0) return vaultPath

  const folderCounts = new Map<string, number>()
  for (const p of referencePaths) {
    const relative = p.startsWith(vaultPath) ? p.slice(vaultPath.length + 1) : p
    const lastSlash = relative.lastIndexOf('/')
    const folder = lastSlash > 0 ? relative.slice(0, lastSlash) : ''
    if (folder) {
      folderCounts.set(folder, (folderCounts.get(folder) ?? 0) + 1)
    }
  }

  if (folderCounts.size === 0) return vaultPath

  let bestFolder = ''
  let bestCount = 0
  for (const [folder, count] of folderCounts) {
    if (count > bestCount) {
      bestFolder = folder
      bestCount = count
    }
  }

  // Only suggest if majority of references are in the same folder
  if (bestCount > referencePaths.length / 2) {
    return `${vaultPath}/${bestFolder}`
  }

  return vaultPath
}
