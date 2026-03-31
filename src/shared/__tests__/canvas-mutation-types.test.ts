import { describe, expect, it } from 'vitest'
import type { CanvasNode, CanvasEdge } from '../canvas-types'
import { buildFolderMapPlan, filterCanvasAdditions } from '../canvas-mutation-types'
import type { CanvasMutationOp, CanvasMutationPlan } from '../canvas-mutation-types'

const makeNode = (id: string, type: CanvasNode['type'] = 'project-file'): CanvasNode => ({
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

describe('CanvasMutationOp type coverage', () => {
  it('accepts all seven operation types', () => {
    const ops: CanvasMutationOp[] = [
      { type: 'add-node', node: makeNode('n1') },
      { type: 'add-edge', edge: makeEdge('e1', 'n1', 'n2') },
      { type: 'move-node', nodeId: 'n1', position: { x: 10, y: 20 } },
      { type: 'resize-node', nodeId: 'n1', size: { width: 300, height: 200 } },
      { type: 'update-metadata', nodeId: 'n1', metadata: { language: 'ts' } },
      { type: 'remove-node', nodeId: 'n1' },
      { type: 'remove-edge', edgeId: 'e1' }
    ]
    expect(ops).toHaveLength(7)
    expect(ops.map((o) => o.type)).toEqual([
      'add-node',
      'add-edge',
      'move-node',
      'resize-node',
      'update-metadata',
      'remove-node',
      'remove-edge'
    ])
  })
})

describe('buildFolderMapPlan', () => {
  it('returns a plan with correct source and operationId', () => {
    const plan = buildFolderMapPlan('op_1', [], [], 0, 0)
    expect(plan.operationId).toBe('op_1')
    expect(plan.source).toBe('folder-map')
  })

  it('generates a unique id starting with plan_', () => {
    const plan = buildFolderMapPlan('op_1', [], [], 0, 0)
    expect(plan.id).toMatch(/^plan_/)
  })

  it('creates add-node ops for each node', () => {
    const nodes = [makeNode('n1'), makeNode('n2')]
    const plan = buildFolderMapPlan('op_1', nodes, [], 0, 0)
    const addNodeOps = plan.ops.filter((op) => op.type === 'add-node')
    expect(addNodeOps).toHaveLength(2)
    expect(addNodeOps[0]).toEqual({ type: 'add-node', node: nodes[0] })
    expect(addNodeOps[1]).toEqual({ type: 'add-node', node: nodes[1] })
  })

  it('creates add-edge ops for each edge', () => {
    const edges = [makeEdge('e1', 'n1', 'n2')]
    const plan = buildFolderMapPlan('op_1', [], edges, 0, 0)
    const addEdgeOps = plan.ops.filter((op) => op.type === 'add-edge')
    expect(addEdgeOps).toHaveLength(1)
    expect(addEdgeOps[0]).toEqual({ type: 'add-edge', edge: edges[0] })
  })

  it('places node ops before edge ops', () => {
    const nodes = [makeNode('n1')]
    const edges = [makeEdge('e1', 'n1', 'n2')]
    const plan = buildFolderMapPlan('op_1', nodes, edges, 0, 0)
    expect(plan.ops[0].type).toBe('add-node')
    expect(plan.ops[1].type).toBe('add-edge')
  })

  it('computes summary correctly', () => {
    const nodes = [makeNode('n1'), makeNode('n2'), makeNode('n3')]
    const edges = [makeEdge('e1', 'n1', 'n2'), makeEdge('e2', 'n2', 'n3')]
    const plan = buildFolderMapPlan('op_1', nodes, edges, 5, 2)
    expect(plan.summary).toEqual({
      addedNodes: 3,
      addedEdges: 2,
      movedNodes: 0,
      skippedFiles: 5,
      unresolvedRefs: 2
    })
  })

  it('returns empty ops for empty inputs', () => {
    const plan = buildFolderMapPlan('op_empty', [], [], 0, 0)
    expect(plan.ops).toHaveLength(0)
    expect(plan.summary.addedNodes).toBe(0)
    expect(plan.summary.addedEdges).toBe(0)
  })

  it('does not mutate the input arrays', () => {
    const nodes = Object.freeze([makeNode('n1')])
    const edges = Object.freeze([makeEdge('e1', 'n1', 'n2')])
    const plan = buildFolderMapPlan('op_1', nodes, edges, 0, 0)
    expect(plan.ops).toHaveLength(2)
  })

  it('plan satisfies CanvasMutationPlan interface shape', () => {
    const plan: CanvasMutationPlan = buildFolderMapPlan('op_shape', [], [], 0, 0)
    expect(plan).toHaveProperty('id')
    expect(plan).toHaveProperty('operationId')
    expect(plan).toHaveProperty('source')
    expect(plan).toHaveProperty('ops')
    expect(plan).toHaveProperty('summary')
  })
})

describe('filterCanvasAdditions', () => {
  it('skips nodes whose ids already exist on the canvas', () => {
    const existingNode = makeNode('existing')
    const newNode = makeNode('new')

    const filtered = filterCanvasAdditions([existingNode, newNode], [], [existingNode], [])

    expect(filtered.nodes).toEqual([newNode])
  })

  it('deduplicates edges against existing canvas edges and new duplicates', () => {
    const existingA = makeNode('a')
    const existingB = makeNode('b')
    const existingEdge = makeEdge('edge-existing', 'a', 'b')
    const duplicateEdge = makeEdge('edge-duplicate', 'a', 'b')
    const uniqueEdge = {
      ...makeEdge('edge-unique', 'b', 'a'),
      kind: 'cluster' as const
    }

    const filtered = filterCanvasAdditions(
      [],
      [duplicateEdge, duplicateEdge, uniqueEdge],
      [existingA, existingB],
      [existingEdge]
    )

    expect(filtered.edges).toEqual([uniqueEdge])
  })
})
