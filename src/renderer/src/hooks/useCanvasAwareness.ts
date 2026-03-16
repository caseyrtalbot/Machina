import { useMemo } from 'react'
import { useCanvasStore } from '../store/canvas-store'
import { useVaultStore } from '../store/vault-store'
import type { CanvasNode } from '@shared/canvas-types'
import type { GraphEdge } from '@shared/types'

// ---------------------------------------------------------------------------
// Pure derivation functions (unit-testable without React)
// ---------------------------------------------------------------------------

/** Extract the set of file paths from note-type canvas nodes. */
export function deriveCanvasFilePaths(nodes: readonly CanvasNode[]): Set<string> {
  const paths = new Set<string>()
  for (const node of nodes) {
    if (node.type === 'note' && node.content) {
      paths.add(node.content)
    }
  }
  return paths
}

/**
 * For each on-canvas file, count how many *other* on-canvas files it connects
 * to in the knowledge graph. Returns counts only for files with >= 1 connection.
 */
export function deriveCanvasConnectionCounts(
  onCanvasPaths: ReadonlySet<string>,
  fileToId: Readonly<Record<string, string>>,
  edges: readonly GraphEdge[]
): Map<string, number> {
  // Build id -> path reverse lookup (only for on-canvas files)
  const idToPath = new Map<string, string>()
  for (const path of onCanvasPaths) {
    const id = fileToId[path]
    if (id) idToPath.set(id, path)
  }

  const counts = new Map<string, number>()

  for (const edge of edges) {
    const sourcePath = idToPath.get(edge.source)
    const targetPath = idToPath.get(edge.target)

    // Both ends must be on canvas
    if (!sourcePath || !targetPath) continue
    // Skip self-links
    if (sourcePath === targetPath) continue

    counts.set(sourcePath, (counts.get(sourcePath) ?? 0) + 1)
    counts.set(targetPath, (counts.get(targetPath) ?? 0) + 1)
  }

  return counts
}

// ---------------------------------------------------------------------------
// React hooks wrapping the pure functions
// ---------------------------------------------------------------------------

/** Subscribe to canvas store and derive the set of file paths on canvas. */
export function useCanvasFilePaths(): ReadonlySet<string> {
  const nodes = useCanvasStore((s) => s.nodes)
  return useMemo(() => deriveCanvasFilePaths(nodes), [nodes])
}

/** Derive connection counts for on-canvas files from the knowledge graph. */
export function useCanvasConnectionCounts(
  onCanvasPaths: ReadonlySet<string>
): ReadonlyMap<string, number> {
  const edges = useVaultStore((s) => s.graph.edges)
  const fileToId = useVaultStore((s) => s.fileToId)

  return useMemo(
    () => deriveCanvasConnectionCounts(onCanvasPaths, fileToId, edges),
    [onCanvasPaths, fileToId, edges]
  )
}
