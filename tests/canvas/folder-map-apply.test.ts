import { describe, it, expect, beforeEach } from 'vitest'
import { useCanvasStore } from '../../src/renderer/src/store/canvas-store'
import { createCanvasNode, createCanvasEdge } from '../../src/shared/canvas-types'
import { CommandStack } from '../../src/renderer/src/panels/canvas/canvas-commands'
import { applyFolderMapPlan } from '../../src/renderer/src/panels/canvas/folder-map-apply'
import type { CanvasMutationPlan } from '../../src/shared/canvas-mutation-types'

describe('folder-map-apply', () => {
  let commandStack: CommandStack

  beforeEach(() => {
    useCanvasStore.setState(useCanvasStore.getInitialState())
    useCanvasStore.getState().loadCanvas('/test/canvas.canvas', {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    })
    commandStack = new CommandStack()
  })

  function makePlan(nodeCount: number): {
    plan: CanvasMutationPlan
    nodes: ReturnType<typeof createCanvasNode>[]
    edges: ReturnType<typeof createCanvasEdge>[]
  } {
    const nodes = Array.from({ length: nodeCount }, (_, i) =>
      createCanvasNode('project-file', { x: i * 100, y: 0 })
    )
    const edges =
      nodeCount > 1
        ? [createCanvasEdge(nodes[0].id, nodes[1].id, 'right', 'left', 'connection')]
        : []
    const plan: CanvasMutationPlan = {
      id: 'plan_test',
      operationId: 'op_test',
      source: 'folder-map',
      ops: [
        ...nodes.map((n) => ({ type: 'add-node' as const, node: n })),
        ...edges.map((e) => ({ type: 'add-edge' as const, edge: e }))
      ],
      summary: {
        addedNodes: nodeCount,
        addedEdges: edges.length,
        movedNodes: 0,
        skippedFiles: 0,
        unresolvedRefs: 0
      }
    }
    return { plan, nodes, edges }
  }

  it('apply adds nodes and edges to store', () => {
    const { plan } = makePlan(3)
    applyFolderMapPlan(plan, commandStack)
    expect(useCanvasStore.getState().nodes.length).toBe(3)
  })

  it('undo removes all added nodes', async () => {
    const { plan } = makePlan(3)
    applyFolderMapPlan(plan, commandStack)
    expect(useCanvasStore.getState().nodes.length).toBe(3)
    await commandStack.undo()
    expect(useCanvasStore.getState().nodes.length).toBe(0)
  })

  it('redo restores nodes', async () => {
    const { plan } = makePlan(2)
    applyFolderMapPlan(plan, commandStack)
    await commandStack.undo()
    await commandStack.redo()
    expect(useCanvasStore.getState().nodes.length).toBe(2)
  })

  it('undo removes edges that connect existing nodes', async () => {
    const existingA = createCanvasNode('project-file', { x: 0, y: 0 })
    const existingB = createCanvasNode('project-file', { x: 200, y: 0 })
    useCanvasStore.getState().addNodesAndEdges([existingA, existingB], [])

    const edge = createCanvasEdge(existingA.id, existingB.id, 'right', 'left', 'connection')
    const plan: CanvasMutationPlan = {
      id: 'plan_existing_edge',
      operationId: 'op_existing_edge',
      source: 'folder-map',
      ops: [{ type: 'add-edge', edge }],
      summary: {
        addedNodes: 0,
        addedEdges: 1,
        movedNodes: 0,
        skippedFiles: 0,
        unresolvedRefs: 0
      }
    }

    applyFolderMapPlan(plan, commandStack)
    expect(useCanvasStore.getState().edges).toHaveLength(1)

    await commandStack.undo()
    expect(useCanvasStore.getState().edges).toHaveLength(0)
  })
})
