/**
 * Undo wrapping for folder map commits.
 * Separated from orchestrator for single-responsibility.
 */

import type { CanvasNode, CanvasEdge } from '@shared/canvas-types'
import type { CanvasMutationPlan } from '@shared/canvas-mutation-types'
import type { CanvasStoreApi } from '../../store/canvas-store'
import type { CommandStack } from './canvas-commands'

/**
 * Apply a folder map plan to the canvas store, wrapped in a CommandStack
 * command for single Cmd+Z undo.
 */
export function applyFolderMapPlan(
  store: CanvasStoreApi,
  plan: CanvasMutationPlan,
  commandStack: CommandStack
): void {
  // Extract nodes and edges from plan ops
  const newNodes: CanvasNode[] = []
  const newEdges: CanvasEdge[] = []
  for (const op of plan.ops) {
    if (op.type === 'add-node') newNodes.push(op.node)
    if (op.type === 'add-edge') newEdges.push(op.edge)
  }

  // Wrap in undo command
  commandStack.execute({
    execute: () => {
      store.getState().addNodesAndEdges(newNodes, newEdges)
    },
    undo: () => {
      const s = store.getState()
      for (const edge of newEdges) s.removeEdge(edge.id)
      for (const node of newNodes) s.removeNode(node.id)
    }
  })
}
