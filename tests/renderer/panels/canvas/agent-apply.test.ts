import { describe, it, expect, beforeEach } from 'vitest'
import {
  applyAgentResult,
  filterStaleOps
} from '../../../../src/renderer/src/panels/canvas/agent-apply'
import { CommandStack } from '../../../../src/renderer/src/panels/canvas/canvas-commands'
import { useCanvasStore } from '../../../../src/renderer/src/store/canvas-store'
import type { CanvasMutationPlan, CanvasMutationOp } from '@shared/canvas-mutation-types'
import type { CanvasNode } from '@shared/canvas-types'

function makeNode(id: string, x = 0, y = 0): CanvasNode {
  return {
    id,
    type: 'text',
    position: { x, y },
    size: { width: 200, height: 100 },
    content: `Content ${id}`,
    metadata: {}
  }
}

function makePlan(ops: CanvasMutationOp[]): CanvasMutationPlan {
  return {
    id: 'p1',
    operationId: 'op1',
    source: 'agent',
    ops,
    summary: { addedNodes: 0, addedEdges: 0, movedNodes: 0, skippedFiles: 0, unresolvedRefs: 0 }
  }
}

describe('filterStaleOps', () => {
  it('keeps ops that reference existing nodes', () => {
    const nodeIds = new Set(['a', 'b'])
    const ops: CanvasMutationOp[] = [
      { type: 'move-node', nodeId: 'a', position: { x: 100, y: 100 } }
    ]
    expect(filterStaleOps(ops, nodeIds)).toHaveLength(1)
  })

  it('removes move-node ops for deleted nodes', () => {
    const nodeIds = new Set(['a'])
    const ops: CanvasMutationOp[] = [
      { type: 'move-node', nodeId: 'gone', position: { x: 100, y: 100 } }
    ]
    expect(filterStaleOps(ops, nodeIds)).toHaveLength(0)
  })

  it('removes remove-node ops for already-deleted nodes', () => {
    const nodeIds = new Set(['a'])
    const ops: CanvasMutationOp[] = [{ type: 'remove-node', nodeId: 'gone' }]
    expect(filterStaleOps(ops, nodeIds)).toHaveLength(0)
  })

  it('keeps add-node ops (new nodes always valid)', () => {
    const nodeIds = new Set<string>()
    const ops: CanvasMutationOp[] = [{ type: 'add-node', node: makeNode('new1') }]
    expect(filterStaleOps(ops, nodeIds)).toHaveLength(1)
  })

  it('removes add-edge ops where a referenced node is gone', () => {
    const nodeIds = new Set(['a'])
    const ops: CanvasMutationOp[] = [
      {
        type: 'add-edge',
        edge: {
          id: 'e1',
          fromNode: 'a',
          toNode: 'gone',
          fromSide: 'bottom',
          toSide: 'top'
        }
      }
    ]
    expect(filterStaleOps(ops, nodeIds)).toHaveLength(0)
  })

  it('keeps add-edge ops when both nodes exist or are being added', () => {
    const nodeIds = new Set(['a'])
    const ops: CanvasMutationOp[] = [
      { type: 'add-node', node: makeNode('new1') },
      {
        type: 'add-edge',
        edge: {
          id: 'e1',
          fromNode: 'a',
          toNode: 'new1',
          fromSide: 'bottom',
          toSide: 'top'
        }
      }
    ]
    expect(filterStaleOps(ops, nodeIds)).toHaveLength(2)
  })
})

describe('applyAgentResult', () => {
  let commandStack: CommandStack

  beforeEach(() => {
    commandStack = new CommandStack()
    useCanvasStore.setState(useCanvasStore.getInitialState())
  })

  it('applies add-node ops to the store', () => {
    const plan = makePlan([{ type: 'add-node', node: makeNode('new1', 100, 200) }])

    applyAgentResult(plan, commandStack)

    const { nodes } = useCanvasStore.getState()
    expect(nodes.find((n) => n.id === 'new1')).toBeTruthy()
  })

  it('undoes the entire plan with a single undo', async () => {
    useCanvasStore.setState({ nodes: [makeNode('existing', 50, 50)], edges: [] })

    const plan = makePlan([
      { type: 'add-node', node: makeNode('new1', 100, 200) },
      { type: 'move-node', nodeId: 'existing', position: { x: 300, y: 400 } }
    ])

    applyAgentResult(plan, commandStack)

    // Verify applied
    let state = useCanvasStore.getState()
    expect(state.nodes).toHaveLength(2)
    expect(state.nodes.find((n) => n.id === 'existing')?.position).toEqual({ x: 300, y: 400 })

    // Undo
    await commandStack.undo()

    state = useCanvasStore.getState()
    expect(state.nodes).toHaveLength(1)
    expect(state.nodes[0].id).toBe('existing')
    expect(state.nodes[0].position).toEqual({ x: 50, y: 50 })
  })

  it('supports redo after undo', async () => {
    const plan = makePlan([{ type: 'add-node', node: makeNode('new1') }])

    applyAgentResult(plan, commandStack)
    expect(useCanvasStore.getState().nodes).toHaveLength(1)

    await commandStack.undo()
    expect(useCanvasStore.getState().nodes).toHaveLength(0)

    await commandStack.redo()
    expect(useCanvasStore.getState().nodes).toHaveLength(1)
  })

  it('filters stale ops before applying', () => {
    // Canvas has node 'a' but not 'gone'
    useCanvasStore.setState({ nodes: [makeNode('a')], edges: [] })

    const plan = makePlan([
      { type: 'move-node', nodeId: 'a', position: { x: 100, y: 100 } },
      { type: 'move-node', nodeId: 'gone', position: { x: 200, y: 200 } }
    ])

    // Should apply without error, filtering the stale op
    applyAgentResult(plan, commandStack)

    const state = useCanvasStore.getState()
    expect(state.nodes.find((n) => n.id === 'a')?.position).toEqual({ x: 100, y: 100 })
  })
})
