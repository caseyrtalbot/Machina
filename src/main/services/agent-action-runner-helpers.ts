import type { CanvasMutationOp, CanvasMutationPlan } from '@shared/canvas-mutation-types'
import type { AgentActionName } from '@shared/agent-action-types'
import { randomUUID } from 'crypto'

/** Actions that produce a cluster rooted at a prompt card. */
const CLUSTER_PRODUCING_ACTIONS: ReadonlySet<AgentActionName> = new Set([
  'ask',
  'challenge',
  'compile',
  'emerge'
])

export function isClusterProducingAction(action: AgentActionName): boolean {
  return CLUSTER_PRODUCING_ACTIONS.has(action)
}

export function newClusterId(): string {
  return `cl-${randomUUID()}`
}

/**
 * Stamp cluster_id + origin=agent + cluster_sources on the first
 * add-node op (the root prompt card produced by the agent).
 * Idempotent: later ops are left alone.
 */
export function stampRootCardWithCluster(
  plan: CanvasMutationPlan,
  clusterId: string,
  sources: readonly string[]
): CanvasMutationPlan {
  let stamped = false
  const ops: CanvasMutationOp[] = plan.ops.map((op) => {
    if (stamped) return op
    if (op.type !== 'add-node') return op
    stamped = true
    return {
      type: 'add-node',
      node: {
        ...op.node,
        metadata: {
          ...op.node.metadata,
          origin: 'agent',
          cluster_id: clusterId,
          cluster_sources: [...sources]
        }
      }
    }
  })
  return { ...plan, ops }
}
