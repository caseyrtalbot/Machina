/**
 * Undo-aware application of agent mutation plans to the canvas.
 * Wraps the entire plan in a single CommandStack command so
 * one Cmd+Z reverts all operations atomically.
 *
 * Includes stale op filtering: if a node was deleted between compute
 * and apply, ops referencing it are silently dropped (spec: Error Handling).
 *
 * Two-phase apply for materialize-artifact ops:
 *   Phase A: Materialize files to disk via IPC
 *   Phase B: Apply canvas mutations via CommandStack (with atomic undo
 *            that also unmaterializes files)
 *
 * Follows the same pattern as ontology-apply.ts.
 */

import { useCanvasStore } from '../../store/canvas-store'
import { useVaultStore } from '../../store/vault-store'
import type { CanvasMutationPlan, CanvasMutationOp } from '@shared/canvas-mutation-types'
import type { MaterializeResult } from '@shared/agent-artifact-types'
import type { CanvasNode } from '@shared/canvas-types'
import type { CommandStack } from './canvas-commands'

/**
 * Filters ops that reference nodes no longer in the canvas.
 * add-node ops are always kept (they create new nodes).
 * materialize-artifact ops are always kept (they create new nodes via tempNodeId).
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

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function isPersistenceEnabled(): boolean {
  return useVaultStore.getState().config?.compile?.persistenceEnabled !== false
}

function getVaultPath(): string {
  return useVaultStore.getState().vaultPath ?? ''
}

type MaterializeArtifactOp = Extract<CanvasMutationOp, { type: 'materialize-artifact' }>

function isMaterializeOp(op: CanvasMutationOp): op is MaterializeArtifactOp {
  return op.type === 'materialize-artifact'
}

/**
 * Convert a materialize-artifact op into a fallback add-node op
 * that creates a markdown card with the draft's title and body.
 * Used when persistence is disabled.
 */
function rewriteAsFallbackAddNode(op: MaterializeArtifactOp): CanvasMutationOp {
  const node: CanvasNode = {
    id: op.tempNodeId,
    type: 'markdown',
    position: { x: op.placement.x, y: op.placement.y },
    size: { width: op.placement.width, height: op.placement.height },
    content: `# ${op.draft.title}\n\n${op.draft.body}`,
    metadata: { viewMode: 'rendered', origin: op.draft.origin }
  }
  return { type: 'add-node', node }
}

/**
 * Rewrite a materialize-artifact op into an add-node op that creates
 * a file-view card pointing at the materialized file.
 */
function rewriteAsFileViewAddNode(
  op: MaterializeArtifactOp,
  result: MaterializeResult
): CanvasMutationOp {
  const node: CanvasNode = {
    id: op.tempNodeId,
    type: 'file-view',
    position: { x: op.placement.x, y: op.placement.y },
    size: { width: op.placement.width, height: op.placement.height },
    content: result.vaultRelativePath,
    metadata: {
      filePath: result.absolutePath,
      artifactId: result.artifactId,
      origin: op.draft.origin
    }
  }
  return { type: 'add-node', node }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Snapshot nodes/edges, then push an apply/undo pair onto the command stack.
 * `extraUndo` runs after restoring state (e.g., to unmaterialize files).
 */
function executeAgentPlanCommand(
  plan: CanvasMutationPlan,
  commandStack: CommandStack,
  extraUndo?: () => Promise<void>
): void {
  const { nodes: prevNodes, edges: prevEdges } = useCanvasStore.getState()

  commandStack.execute({
    execute: () => {
      useCanvasStore.getState().applyAgentPlan(plan)
    },
    undo: async () => {
      useCanvasStore.setState({ nodes: prevNodes, edges: prevEdges, isDirty: true })
      if (extraUndo) await extraUndo()
    }
  })
}

/* ------------------------------------------------------------------ */
/*  Two-phase apply with persistence                                  */
/* ------------------------------------------------------------------ */

async function applyWithPersistence(
  filteredPlan: CanvasMutationPlan,
  commandStack: CommandStack,
  materializeOps: MaterializeArtifactOp[],
  otherOps: CanvasMutationOp[]
): Promise<void> {
  const vaultPath = getVaultPath()

  // Phase A: Materialize files to disk via IPC
  const results: MaterializeResult[] = []
  try {
    for (const op of materializeOps) {
      const result = await window.api.artifact.materialize(op.draft, vaultPath)
      results.push(result)
    }
  } catch (err) {
    // Rollback any already-materialized files (best-effort; original error matters more)
    if (results.length > 0) {
      const paths = results.map((r) => r.absolutePath)
      try {
        await window.api.artifact.unmaterialize(paths, vaultPath)
      } catch {
        /* swallow */
      }
    }
    throw err
  }

  // Phase B: Rewrite materialize ops to file-view add-node ops, then apply
  const rewrittenPlan: CanvasMutationPlan = {
    ...filteredPlan,
    ops: [...otherOps, ...materializeOps.map((op, i) => rewriteAsFileViewAddNode(op, results[i]))]
  }

  executeAgentPlanCommand(rewrittenPlan, commandStack, async () => {
    const paths = results.map((r) => r.absolutePath)
    await window.api.artifact.unmaterialize(paths, vaultPath)
  })
}

/* ------------------------------------------------------------------ */
/*  Main entry point                                                  */
/* ------------------------------------------------------------------ */

/**
 * Applies an agent mutation plan to the canvas store, wrapped in a
 * CommandStack command for atomic undo/redo support.
 *
 * Stale ops (referencing nodes deleted between compute and apply)
 * are filtered out before application.
 *
 * For plans containing materialize-artifact ops:
 * - If persistence is enabled: two-phase apply (materialize files, then canvas)
 * - If persistence is disabled: fallback to markdown card nodes
 */
export async function applyAgentResult(
  plan: CanvasMutationPlan,
  commandStack: CommandStack
): Promise<void> {
  const { nodes } = useCanvasStore.getState()

  // Filter out ops referencing nodes deleted during compute
  const currentNodeIds = new Set(nodes.map((n) => n.id))
  const filteredOps = filterStaleOps(plan.ops, currentNodeIds)

  if (filteredOps.length === 0) return

  const filteredPlan: CanvasMutationPlan = { ...plan, ops: filteredOps }
  const materializeOps = filteredOps.filter(isMaterializeOp)

  // Fast path: no materialize ops
  if (materializeOps.length === 0) {
    executeAgentPlanCommand(filteredPlan, commandStack)
    return
  }

  const otherOps = filteredOps.filter((op) => !isMaterializeOp(op))

  if (isPersistenceEnabled()) {
    await applyWithPersistence(filteredPlan, commandStack, materializeOps, otherOps)
    return
  }

  // Persistence disabled: rewrite materialize ops as markdown fallback cards
  const fallbackPlan: CanvasMutationPlan = {
    ...filteredPlan,
    ops: [...otherOps, ...materializeOps.map(rewriteAsFallbackAddNode)]
  }
  executeAgentPlanCommand(fallbackPlan, commandStack)
}
