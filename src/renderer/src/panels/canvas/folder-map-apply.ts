/**
 * Pending-apply safety and undo wrapping for folder map commits.
 * Separated from orchestrator for single-responsibility.
 */

import type { CanvasFile, CanvasNode, CanvasEdge } from '@shared/canvas-types'
import type { CanvasMutationPlan } from '@shared/canvas-mutation-types'
import { useCanvasStore } from '../../store/canvas-store'
import type { CommandStack } from './canvas-commands'

interface PendingApply {
  readonly operationId: string
  readonly canvasPath: string
  readonly preApplySnapshot: CanvasFile
}

let pendingApply: PendingApply | null = null

export function getPendingApply(): PendingApply | null {
  return pendingApply
}

/**
 * Apply a folder map plan to the canvas store, wrapped in a CommandStack
 * command for single Cmd+Z undo.
 */
export function applyFolderMapPlan(plan: CanvasMutationPlan, commandStack: CommandStack): void {
  const store = useCanvasStore.getState()
  const canvasPath = store.filePath

  // Extract nodes and edges from plan ops
  const newNodes: CanvasNode[] = []
  const newEdges: CanvasEdge[] = []
  for (const op of plan.ops) {
    if (op.type === 'add-node') newNodes.push(op.node)
    if (op.type === 'add-edge') newEdges.push(op.edge)
  }

  // Capture pre-apply snapshot for rollback
  if (canvasPath) {
    pendingApply = {
      operationId: plan.operationId,
      canvasPath,
      preApplySnapshot: store.toCanvasFile()
    }
  }

  // Wrap in undo command
  commandStack.execute({
    execute: () => {
      useCanvasStore.getState().addNodesAndEdges(newNodes, newEdges)
    },
    undo: () => {
      const s = useCanvasStore.getState()
      for (const node of newNodes) s.removeNode(node.id)
    }
  })

  // Clear pending marker (async flush would happen via autosave)
  pendingApply = null
}

/**
 * If a pending apply exists during quit, rollback to pre-apply snapshot.
 * Called from the coordinated quit flow.
 */
export function rollbackPendingApplyIfNeeded(): void {
  if (!pendingApply) return
  const snapshot = pendingApply.preApplySnapshot
  useCanvasStore.getState().loadCanvas(pendingApply.canvasPath, snapshot)
  pendingApply = null
}
