import type { CanvasMutationPlan } from '@shared/canvas-mutation-types'
import type { CanvasNode, CanvasEdge } from '@shared/canvas-types'
import { buildClusterDraft } from './cluster-capture'
import { applyAgentResult } from './agent-apply'
import type { CommandStack } from './canvas-commands'

export type CaptureOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'too-few-sections' | 'root-not-found' | string }

/**
 * Build the CanvasMutationPlan for an agent-rooted cluster capture and
 * apply it through the existing agent pipeline. The first op materializes
 * the cluster file; the trailing `__convertToFileView` sentinels tell
 * `applyAgentResult` which cards to swap into section-projected file-views.
 */
export async function captureClusterFromRoot(
  rootCardId: string,
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  commandStack: CommandStack
): Promise<CaptureOutcome> {
  const root = nodes.find((n) => n.id === rootCardId)
  if (!root) return { ok: false, reason: 'root-not-found' }

  const sourceIds = (root.metadata.cluster_sources as readonly string[] | undefined) ?? []
  const clusterId = root.metadata.cluster_id as string | undefined
  const agentSources: Record<string, readonly string[]> = clusterId
    ? { [clusterId]: sourceIds }
    : {}

  const draft = buildClusterDraft(rootCardId, [], { nodes, edges, agentSources })
  if (draft.sections.length < 2) return { ok: false, reason: 'too-few-sections' }

  const capId = `cap_${crypto.randomUUID()}`
  const plan: CanvasMutationPlan = {
    id: capId,
    operationId: capId,
    source: 'agent',
    ops: [
      {
        type: 'materialize-artifact',
        draft,
        placement: {
          x: root.position.x,
          y: root.position.y,
          width: root.size.width,
          height: root.size.height
        },
        tempNodeId: `cluster_${crypto.randomUUID()}`
      }
    ],
    summary: { addedNodes: 0, addedEdges: 0, movedNodes: 0, skippedFiles: 0, unresolvedRefs: 0 }
  }

  try {
    await applyAgentResult(plan, commandStack)
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Ad-hoc capture: user manually selected ≥2 cards and gave a title.
 */
export async function captureClusterFromSelection(
  selectionIds: readonly string[],
  title: string,
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  placement: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  },
  commandStack: CommandStack
): Promise<CaptureOutcome> {
  const draft = buildClusterDraft(null, selectionIds, {
    nodes,
    edges,
    agentSources: {},
    userTitle: title
  })
  if (draft.sections.length < 2) return { ok: false, reason: 'too-few-sections' }

  const capId = `cap_${crypto.randomUUID()}`
  const plan: CanvasMutationPlan = {
    id: capId,
    operationId: capId,
    source: 'agent',
    ops: [
      {
        type: 'materialize-artifact',
        draft,
        placement,
        tempNodeId: `cluster_${crypto.randomUUID()}`
      }
    ],
    summary: { addedNodes: 0, addedEdges: 0, movedNodes: 0, skippedFiles: 0, unresolvedRefs: 0 }
  }

  try {
    await applyAgentResult(plan, commandStack)
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}
