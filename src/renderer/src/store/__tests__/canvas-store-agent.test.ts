import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DEFAULT_CANVAS_ID, getCanvasStore } from '../canvas-store'
import { setErrorNotifier } from '../../utils/error-logger'
import type { CanvasMutationPlan } from '@shared/canvas-mutation-types'
import type { CanvasNode, CanvasEdge } from '@shared/canvas-types'

const store = getCanvasStore(DEFAULT_CANVAS_ID)

const makeNode = (id: string, type: CanvasNode['type'] = 'text'): CanvasNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  size: { width: 240, height: 80 },
  content: id,
  metadata: {}
})

const makeEdge = (id: string, from: string, to: string): CanvasEdge => ({
  id,
  fromNode: from,
  toNode: to,
  fromSide: 'right',
  toSide: 'left'
})

const makePlan = (ops: CanvasMutationPlan['ops']): CanvasMutationPlan => ({
  id: 'plan_test',
  operationId: 'op_test',
  source: 'agent',
  ops,
  summary: {
    addedNodes: 0,
    addedEdges: 0,
    movedNodes: 0,
    skippedFiles: 0,
    unresolvedRefs: 0
  }
})

describe('canvas-store applyAgentPlan', () => {
  beforeEach(() => {
    store.setState(store.getInitialState())
  })

  it('adds nodes and edges from a plan', () => {
    const plan = makePlan([
      { type: 'add-node', node: makeNode('n1') },
      { type: 'add-node', node: makeNode('n2') },
      { type: 'add-edge', edge: makeEdge('e1', 'n1', 'n2') }
    ])
    store.getState().applyAgentPlan(plan)
    const { nodes, edges, isDirty } = store.getState()
    expect(nodes).toHaveLength(2)
    expect(edges).toHaveLength(1)
    expect(isDirty).toBe(true)
  })

  it('moves existing nodes', () => {
    store.setState({ nodes: [makeNode('n1')], isDirty: false })
    const plan = makePlan([{ type: 'move-node', nodeId: 'n1', position: { x: 500, y: 300 } }])
    store.getState().applyAgentPlan(plan)
    const { nodes, isDirty } = store.getState()
    expect(nodes[0].position).toEqual({ x: 500, y: 300 })
    expect(isDirty).toBe(true)
  })

  it('removes nodes and cleans up edges', () => {
    store.setState({
      nodes: [makeNode('n1'), makeNode('n2')],
      edges: [makeEdge('e1', 'n1', 'n2')],
      isDirty: false
    })
    const plan = makePlan([{ type: 'remove-node', nodeId: 'n1' }])
    store.getState().applyAgentPlan(plan)
    const { nodes, edges } = store.getState()
    expect(nodes).toHaveLength(1)
    expect(nodes[0].id).toBe('n2')
    expect(edges).toHaveLength(0)
  })

  it('rejects a plan whose ops no longer validate against live store state', () => {
    const notify = vi.fn()
    setErrorNotifier(notify)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      store.setState({ nodes: [makeNode('n1')], isDirty: false })
      // n-gone was removed from the live canvas after the plan was built.
      const plan = makePlan([{ type: 'move-node', nodeId: 'n-gone', position: { x: 1, y: 1 } }])
      store.getState().applyAgentPlan(plan)
      const { nodes, isDirty } = store.getState()
      expect(nodes[0].position).toEqual({ x: 0, y: 0 })
      expect(isDirty).toBe(false)
      expect(notify).toHaveBeenCalledTimes(1)
    } finally {
      setErrorNotifier(() => {})
      spy.mockRestore()
    }
  })

  it('rejects a plan adding a node whose id now exists in the live store', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      store.setState({ nodes: [makeNode('n1')], isDirty: false })
      const plan = makePlan([{ type: 'add-node', node: makeNode('n1') }])
      store.getState().applyAgentPlan(plan)
      expect(store.getState().nodes).toHaveLength(1)
      expect(store.getState().isDirty).toBe(false)
    } finally {
      spy.mockRestore()
    }
  })

  it('applies all ops in a single store update', () => {
    let updateCount = 0
    const unsub = store.subscribe(() => {
      updateCount++
    })
    const plan = makePlan([
      { type: 'add-node', node: makeNode('n1') },
      { type: 'add-node', node: makeNode('n2') },
      { type: 'add-node', node: makeNode('n3') },
      { type: 'add-edge', edge: makeEdge('e1', 'n1', 'n2') },
      { type: 'add-edge', edge: makeEdge('e2', 'n2', 'n3') }
    ])
    store.getState().applyAgentPlan(plan)
    unsub()
    expect(updateCount).toBe(1)
  })
})
