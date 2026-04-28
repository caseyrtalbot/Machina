import type { CanvasMutationPlan } from '@shared/canvas-mutation-types'
import type { CanvasNode, CanvasNodeType } from '@shared/canvas-types'

interface GhostNode {
  readonly id: string
  readonly type: CanvasNodeType
  readonly position: { readonly x: number; readonly y: number }
  readonly size: { readonly width: number; readonly height: number }
  readonly content: string
  readonly isMoved: boolean
}

interface GhostEdge {
  readonly id: string
  readonly fromNode: string
  readonly toNode: string
  readonly kind?: string
  readonly label?: string
}

const DEFAULT_GHOST_SIZE = { width: 200, height: 100 } as const

/**
 * Computes ghost nodes from a mutation plan.
 * Accepts current nodes so moved-node ghosts use the real card size.
 */
export function computeGhostNodes(
  plan: CanvasMutationPlan,
  currentNodes: readonly CanvasNode[]
): readonly GhostNode[] {
  const nodeMap = new Map(currentNodes.map((n) => [n.id, n]))
  const ghosts: GhostNode[] = []

  for (const op of plan.ops) {
    if (op.type === 'add-node') {
      ghosts.push({
        id: op.node.id,
        type: op.node.type,
        position: op.node.position,
        size: op.node.size,
        content: op.node.content,
        isMoved: false
      })
    } else if (op.type === 'move-node') {
      const existing = nodeMap.get(op.nodeId)
      ghosts.push({
        id: op.nodeId,
        type: existing?.type ?? 'text',
        position: op.position,
        size: existing?.size ?? DEFAULT_GHOST_SIZE,
        content: existing?.content ?? '',
        isMoved: true
      })
    }
  }

  return ghosts
}

export function computeGhostEdges(plan: CanvasMutationPlan): readonly GhostEdge[] {
  const edges: GhostEdge[] = []

  for (const op of plan.ops) {
    if (op.type === 'add-edge') {
      edges.push({
        id: op.edge.id,
        fromNode: op.edge.fromNode,
        toNode: op.edge.toNode,
        kind: op.edge.kind ?? undefined,
        label: op.edge.label ?? undefined
      })
    }
  }

  return edges
}

export function computeRemovedNodeIds(plan: CanvasMutationPlan): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const op of plan.ops) {
    if (op.type === 'remove-node') ids.add(op.nodeId)
  }
  return ids
}
