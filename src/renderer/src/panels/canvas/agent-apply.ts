/**
 * Undo-aware application of agent mutation plans to the canvas.
 * Wraps the entire plan in a single CommandStack command so
 * one Cmd+Z reverts all operations atomically.
 *
 * Includes stale op filtering: if a node was deleted between compute
 * and apply, ops referencing it are silently dropped (spec: Error Handling).
 *
 * Follows the same pattern as ontology-apply.ts.
 */

import { useCanvasStore } from '../../store/canvas-store'
import type { CanvasMutationPlan, CanvasMutationOp } from '@shared/canvas-mutation-types'
import type { CommandStack } from './canvas-commands'

/**
 * Filters ops that reference nodes no longer in the canvas.
 * add-node ops are always kept (they create new nodes).
 * add-edge ops are kept only if both endpoints exist or are being added.
 */
export function filterStaleOps(
  ops: readonly CanvasMutationOp[],
  existingNodeIds: ReadonlySet<string>
): CanvasMutationOp[] {
  // Collect IDs of nodes that will exist after add-node ops
  const willExist = new Set(existingNodeIds)
  for (const op of ops) {
    if (op.type === 'add-node') willExist.add(op.node.id)
    if (op.type === 'materialize-artifact') willExist.add(op.tempNodeId)
  }

  return ops.filter((op) => {
    switch (op.type) {
      case 'add-node':
        return true
      case 'add-edge':
        return willExist.has(op.edge.fromNode) && willExist.has(op.edge.toNode)
      case 'move-node':
      case 'resize-node':
      case 'update-metadata':
        return willExist.has(op.nodeId)
      case 'remove-node':
        return existingNodeIds.has(op.nodeId)
      case 'remove-edge':
        return true
      case 'materialize-artifact':
        return true
    }
  })
}

/**
 * Applies an agent mutation plan to the canvas store, wrapped in a
 * CommandStack command for atomic undo/redo support.
 *
 * Stale ops (referencing nodes deleted between compute and apply)
 * are filtered out before application.
 */
export function applyAgentResult(plan: CanvasMutationPlan, commandStack: CommandStack): void {
  const store = useCanvasStore.getState()

  // Filter out ops referencing nodes deleted during compute
  const currentNodeIds = new Set(store.nodes.map((n) => n.id))
  const filteredOps = filterStaleOps(plan.ops, currentNodeIds)

  if (filteredOps.length === 0) return

  const filteredPlan: CanvasMutationPlan = { ...plan, ops: filteredOps }

  // Capture pre-apply state for undo
  const prevNodes = store.nodes
  const prevEdges = store.edges

  commandStack.execute({
    execute: () => {
      useCanvasStore.getState().applyAgentPlan(filteredPlan)
    },
    undo: () => {
      useCanvasStore.setState({ nodes: prevNodes, edges: prevEdges, isDirty: true })
    }
  })
}
