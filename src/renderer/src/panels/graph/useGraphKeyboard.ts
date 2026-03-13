import { useCallback, useEffect, useRef } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PositionedNode {
  id: string
  title: string
  x: number
  y: number
}

interface GraphEdge {
  source: string
  target: string
  kind: string
}

type ArrowKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'

interface UseGraphKeyboardOptions {
  nodes: readonly PositionedNode[]
  edges: readonly GraphEdge[]
  selectedNodeId: string | null
  onSelectNode: (id: string | null) => void
  onOpenNode: (id: string) => void
  onToggleSelect: (id: string) => void
  enabled?: boolean
}

// ─── Pure helpers (exported for testing) ──────────────────────────────────────

/** Returns a new sorted array of nodes ordered alphabetically by title. */
export function sortNodesAlphabetically<T extends { title: string }>(
  nodes: readonly T[]
): readonly T[] {
  return [...nodes].sort((a, b) => a.title.localeCompare(b.title))
}

/**
 * Finds the nearest neighbor of `current` in the given `direction`.
 *
 * Strategy:
 * 1. Build the set of nodes directly connected to `current` via any edge.
 * 2. Filter to those that lie in the requested directional quadrant.
 * 3. Return the one with the smallest Euclidean distance to `current`, or null.
 */
export function findNearestNeighbor(
  current: PositionedNode,
  allNodes: readonly PositionedNode[],
  edges: readonly GraphEdge[],
  direction: ArrowKey
): PositionedNode | null {
  // Collect ids of nodes connected to `current` (undirected).
  const connectedIds = new Set<string>()
  for (const edge of edges) {
    if (edge.source === current.id) connectedIds.add(edge.target)
    if (edge.target === current.id) connectedIds.add(edge.source)
  }

  const connected = allNodes.filter((n) => connectedIds.has(n.id))

  // Filter by directional quadrant relative to the current node.
  const candidates = connected.filter((n) => {
    const dx = n.x - current.x
    const dy = n.y - current.y
    switch (direction) {
      case 'ArrowRight': return dx > 0
      case 'ArrowLeft':  return dx < 0
      case 'ArrowDown':  return dy > 0
      case 'ArrowUp':    return dy < 0
    }
  })

  if (candidates.length === 0) return null

  // Return the closest by Euclidean distance.
  return candidates.reduce((closest, node) => {
    const distA = euclidean(current, closest)
    const distB = euclidean(current, node)
    return distB < distA ? node : closest
  })
}

function euclidean(a: PositionedNode, b: PositionedNode): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.sqrt(dx * dx + dy * dy)
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Keyboard navigation for the graph panel.
 *
 * Key bindings:
 *   Tab / Shift+Tab  — cycle through nodes in alphabetical order
 *   ArrowUp/Down/Left/Right — move to nearest connected neighbor in that direction
 *   Enter            — open the selected node
 *   Space            — toggle multi-select on the selected node
 *   Escape           — clear selection
 */
export function useGraphKeyboard({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  onOpenNode,
  onToggleSelect,
  enabled = true,
}: UseGraphKeyboardOptions): { handleKeyDown: (e: KeyboardEvent) => void } {
  // Keep a stable ref to avoid stale closures inside the event listener.
  const stateRef = useRef({ nodes, edges, selectedNodeId, onSelectNode, onOpenNode, onToggleSelect })
  useEffect(() => {
    stateRef.current = { nodes, edges, selectedNodeId, onSelectNode, onOpenNode, onToggleSelect }
  })

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return

      const { nodes, edges, selectedNodeId, onSelectNode, onOpenNode, onToggleSelect } =
        stateRef.current

      switch (e.key) {
        case 'Tab': {
          e.preventDefault()
          const sorted = sortNodesAlphabetically(nodes)
          if (sorted.length === 0) return
          const currentIndex = sorted.findIndex((n) => n.id === selectedNodeId)
          const nextIndex = e.shiftKey
            ? (currentIndex - 1 + sorted.length) % sorted.length
            : (currentIndex + 1) % sorted.length
          onSelectNode(sorted[nextIndex].id)
          break
        }

        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight': {
          if (!selectedNodeId) return
          const current = nodes.find((n) => n.id === selectedNodeId)
          if (!current) return
          const neighbor = findNearestNeighbor(current, nodes, edges, e.key as ArrowKey)
          if (neighbor) onSelectNode(neighbor.id)
          break
        }

        case 'Enter': {
          if (selectedNodeId) {
            e.preventDefault()
            onOpenNode(selectedNodeId)
          }
          break
        }

        case ' ': {
          if (selectedNodeId) {
            e.preventDefault()
            onToggleSelect(selectedNodeId)
          }
          break
        }

        case 'Escape': {
          onSelectNode(null)
          break
        }
      }
    },
    [enabled]
  )

  useEffect(() => {
    if (!enabled) return
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [enabled, handleKeyDown])

  return { handleKeyDown }
}
