import { describe, it, expect } from 'vitest'
import {
  stampRootCardWithCluster,
  newClusterId,
  isClusterProducingAction
} from '../agent-action-runner-helpers'
import type { CanvasMutationPlan } from '@shared/canvas-mutation-types'

describe('stampRootCardWithCluster', () => {
  it('adds cluster_id + origin=agent + cluster_sources to the first add-node op', () => {
    const plan: CanvasMutationPlan = {
      id: 'p1',
      operationId: 'op1',
      source: 'agent',
      ops: [
        {
          type: 'add-node',
          node: {
            id: 'root',
            type: 'text',
            position: { x: 0, y: 0 },
            size: { width: 200, height: 80 },
            content: 'prompt text',
            metadata: {}
          }
        },
        {
          type: 'add-node',
          node: {
            id: 'child',
            type: 'text',
            position: { x: 0, y: 100 },
            size: { width: 200, height: 80 },
            content: 'child',
            metadata: {}
          }
        }
      ],
      summary: {
        addedNodes: 2,
        addedEdges: 0,
        movedNodes: 0,
        skippedFiles: 0,
        unresolvedRefs: 0
      }
    }
    const stamped = stampRootCardWithCluster(plan, 'cl-abc', ['src-1'])
    const firstAdd = stamped.ops[0]
    expect(firstAdd.type).toBe('add-node')
    if (firstAdd.type !== 'add-node') return
    expect(firstAdd.node.metadata.cluster_id).toBe('cl-abc')
    expect(firstAdd.node.metadata.origin).toBe('agent')
    expect(firstAdd.node.metadata.cluster_sources).toEqual(['src-1'])

    // Only the first add-node is stamped; later ops untouched.
    const secondAdd = stamped.ops[1]
    if (secondAdd.type !== 'add-node') return
    expect(secondAdd.node.metadata.cluster_id).toBeUndefined()
  })

  it('is a no-op when the plan has no add-node ops', () => {
    const plan: CanvasMutationPlan = {
      id: 'p1',
      operationId: 'op1',
      source: 'agent',
      ops: [{ type: 'move-node', nodeId: 'x', position: { x: 1, y: 2 } }],
      summary: {
        addedNodes: 0,
        addedEdges: 0,
        movedNodes: 1,
        skippedFiles: 0,
        unresolvedRefs: 0
      }
    }
    const stamped = stampRootCardWithCluster(plan, 'cl-x', [])
    expect(stamped.ops).toEqual(plan.ops)
  })
})

describe('newClusterId', () => {
  it('returns a distinct cl-prefixed id each call', () => {
    const a = newClusterId()
    const b = newClusterId()
    expect(a.startsWith('cl-')).toBe(true)
    expect(b.startsWith('cl-')).toBe(true)
    expect(a).not.toBe(b)
  })
})

describe('isClusterProducingAction', () => {
  it('includes ask/challenge/compile/emerge', () => {
    expect(isClusterProducingAction('ask')).toBe(true)
    expect(isClusterProducingAction('challenge')).toBe(true)
    expect(isClusterProducingAction('compile')).toBe(true)
    expect(isClusterProducingAction('emerge')).toBe(true)
  })
  it('excludes organize/tidy', () => {
    expect(isClusterProducingAction('organize')).toBe(false)
    expect(isClusterProducingAction('tidy')).toBe(false)
  })
})
