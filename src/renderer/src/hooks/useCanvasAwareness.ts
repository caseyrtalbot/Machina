import { useMemo } from 'react'
import { useStore } from 'zustand'
import { DEFAULT_CANVAS_ID, getCanvasStore } from '../store/canvas-store'
import { useFocusedCanvasId } from '../store/dock-store'
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

const NO_PATHS: ReadonlySet<string> = new Set()

/**
 * File paths on the FOCUSED canvas (active thread's active dock tab, when it
 * is a canvas) — empty when no canvas is focused. The unconditional useStore
 * call needs some store when unfocused; it reads the default instance but the
 * result is discarded (hooks-order requirement, not a semantic fallback).
 */
export function useCanvasFilePaths(): ReadonlySet<string> {
  const canvasId = useFocusedCanvasId()
  const nodes = useStore(getCanvasStore(canvasId ?? DEFAULT_CANVAS_ID), (s) => s.nodes)
  return useMemo(() => (canvasId ? deriveCanvasFilePaths(nodes) : NO_PATHS), [canvasId, nodes])
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
