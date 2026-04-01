import { describe, expect, it } from 'vitest'
import type { CanvasNode, CanvasEdge } from '../canvas-types'
import { applyPlanOps, buildFolderMapPlan, filterCanvasAdditions } from '../canvas-mutation-types'
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

describe('applyPlanOps', () => {
  it('applies add-node ops', () => {
    const newNode = makeNode('n1')
    const ops: CanvasMutationOp[] = [{ type: 'add-node', node: newNode }]

    const result = applyPlanOps([], [], ops)

    expect(result.nodes).toEqual([newNode])
    expect(result.edges).toEqual([])
  })

  it('applies add-edge ops', () => {
    const nodes = [makeNode('n1'), makeNode('n2')]
    const newEdge = makeEdge('e1', 'n1', 'n2')
    const ops: CanvasMutationOp[] = [{ type: 'add-edge', edge: newEdge }]

    const result = applyPlanOps(nodes, [], ops)

    expect(result.edges).toEqual([newEdge])
    expect(result.nodes).toEqual(nodes)
  })

  it('applies move-node ops', () => {
    const nodes = [makeNode('n1'), makeNode('n2')]
    const ops: CanvasMutationOp[] = [
      { type: 'move-node', nodeId: 'n1', position: { x: 100, y: 200 } }
    ]

    const result = applyPlanOps(nodes, [], ops)

    expect(result.nodes[0].position).toEqual({ x: 100, y: 200 })
    expect(result.nodes[1].position).toEqual({ x: 0, y: 0 })
  })

  it('applies resize-node ops', () => {
    const nodes = [makeNode('n1')]
    const ops: CanvasMutationOp[] = [
      { type: 'resize-node', nodeId: 'n1', size: { width: 500, height: 300 } }
    ]

    const result = applyPlanOps(nodes, [], ops)

    expect(result.nodes[0].size).toEqual({ width: 500, height: 300 })
  })

  it('applies update-metadata ops (merges metadata)', () => {
    const node: CanvasNode = {
      ...makeNode('n1'),
      metadata: { language: 'ts', existing: true }
    }
    const ops: CanvasMutationOp[] = [
      { type: 'update-metadata', nodeId: 'n1', metadata: { language: 'rust', added: 42 } }
    ]

    const result = applyPlanOps([node], [], ops)

    expect(result.nodes[0].metadata).toEqual({
      language: 'rust',
      existing: true,
      added: 42
    })
  })

  it('applies remove-node ops AND cleans up dangling edges', () => {
    const nodes = [makeNode('n1'), makeNode('n2'), makeNode('n3')]
    const edges = [
      makeEdge('e1', 'n1', 'n2'),
      makeEdge('e2', 'n2', 'n3'),
      makeEdge('e3', 'n1', 'n3')
    ]
    const ops: CanvasMutationOp[] = [{ type: 'remove-node', nodeId: 'n1' }]

    const result = applyPlanOps(nodes, edges, ops)

    expect(result.nodes).toHaveLength(2)
    expect(result.nodes.map((n) => n.id)).toEqual(['n2', 'n3'])
    // e1 (n1->n2) and e3 (n1->n3) should be removed as dangling
    expect(result.edges).toHaveLength(1)
    expect(result.edges[0].id).toBe('e2')
  })

  it('applies remove-edge ops', () => {
    const nodes = [makeNode('n1'), makeNode('n2')]
    const edges = [makeEdge('e1', 'n1', 'n2'), makeEdge('e2', 'n2', 'n1')]
    const ops: CanvasMutationOp[] = [{ type: 'remove-edge', edgeId: 'e1' }]

    const result = applyPlanOps(nodes, edges, ops)

    expect(result.edges).toHaveLength(1)
    expect(result.edges[0].id).toBe('e2')
  })

  it('applies multiple ops in sequence', () => {
    const ops: CanvasMutationOp[] = [
      { type: 'add-node', node: makeNode('n1') },
      { type: 'add-node', node: makeNode('n2') },
      { type: 'add-edge', edge: makeEdge('e1', 'n1', 'n2') },
      { type: 'move-node', nodeId: 'n1', position: { x: 50, y: 75 } },
      { type: 'resize-node', nodeId: 'n2', size: { width: 400, height: 200 } },
      { type: 'update-metadata', nodeId: 'n1', metadata: { tag: 'important' } }
    ]

    const result = applyPlanOps([], [], ops)

    expect(result.nodes).toHaveLength(2)
    expect(result.edges).toHaveLength(1)
    expect(result.nodes[0].position).toEqual({ x: 50, y: 75 })
    expect(result.nodes[1].size).toEqual({ width: 400, height: 200 })
    expect(result.nodes[0].metadata).toEqual({ tag: 'important' })
  })

  it('does not mutate input arrays', () => {
    const nodes = Object.freeze([makeNode('n1')]) as readonly CanvasNode[]
    const edges = Object.freeze([makeEdge('e1', 'n1', 'n2')]) as readonly CanvasEdge[]
    const ops: CanvasMutationOp[] = [
      { type: 'add-node', node: makeNode('n2') },
      { type: 'move-node', nodeId: 'n1', position: { x: 99, y: 99 } },
      { type: 'remove-edge', edgeId: 'e1' }
    ]

    const result = applyPlanOps(nodes, edges, ops)

    // Originals untouched
    expect(nodes).toHaveLength(1)
    expect(nodes[0].position).toEqual({ x: 0, y: 0 })
    expect(edges).toHaveLength(1)
    // Result has changes
    expect(result.nodes).toHaveLength(2)
    expect(result.nodes[0].position).toEqual({ x: 99, y: 99 })
    expect(result.edges).toHaveLength(0)
  })

  it('skips ops for nonexistent nodes gracefully', () => {
    const nodes = [makeNode('n1')]
    const edges = [makeEdge('e1', 'n1', 'n2')]
    const ops: CanvasMutationOp[] = [
      { type: 'move-node', nodeId: 'ghost', position: { x: 1, y: 1 } },
      { type: 'resize-node', nodeId: 'ghost', size: { width: 1, height: 1 } },
      { type: 'update-metadata', nodeId: 'ghost', metadata: { x: 1 } },
      { type: 'remove-node', nodeId: 'ghost' },
      { type: 'remove-edge', edgeId: 'ghost-edge' }
    ]

    // Should not throw
    const result = applyPlanOps(nodes, edges, ops)

    expect(result.nodes).toEqual(nodes)
    expect(result.edges).toEqual(edges)
  })
})
