import { describe, it, expect } from 'vitest'
import { applyPlanOps } from '@shared/canvas-mutation-types'
import type { CanvasNode, CanvasEdge } from '@shared/canvas-types'

describe('cluster capture preserves edges', () => {
  it('update-node keeps edges touching the mutated card', () => {
    const nodes: CanvasNode[] = [
      {
        id: 'a',
        type: 'text',
        position: { x: 0, y: 0 },
        size: { width: 100, height: 100 },
        content: 'a',
        metadata: {}
      },
      {
        id: 'b',
        type: 'text',
        position: { x: 200, y: 0 },
        size: { width: 100, height: 100 },
        content: 'b',
        metadata: {}
      }
    ]
    const edges: CanvasEdge[] = [
      { id: 'e1', fromNode: 'a', toNode: 'b', fromSide: 'right', toSide: 'left' }
    ]

    const result = applyPlanOps(nodes, edges, [
      {
        type: 'update-node',
        nodeId: 'a',
        nodeType: 'file-view',
        content: 'clusters/foo.md',
        metadata: { filePath: '/v/clusters/foo.md', section: 'a' }
      }
    ])

    expect(result.edges).toHaveLength(1)
    expect(result.edges[0].id).toBe('e1')
    const updated = result.nodes.find((n) => n.id === 'a')!
    expect(updated.type).toBe('file-view')
    expect(updated.content).toBe('clusters/foo.md')
    expect(updated.metadata.section).toBe('a')
  })

  it('preserves edges across a multi-card cluster conversion', () => {
    const nodes: CanvasNode[] = [
      {
        id: 'a',
        type: 'text',
        position: { x: 0, y: 0 },
        size: { width: 100, height: 100 },
        content: 'a',
        metadata: { title: 'A' }
      },
      {
        id: 'b',
        type: 'text',
        position: { x: 200, y: 0 },
        size: { width: 100, height: 100 },
        content: 'b',
        metadata: { title: 'B' }
      }
    ]
    const edges: CanvasEdge[] = [
      { id: 'e1', fromNode: 'a', toNode: 'b', fromSide: 'right', toSide: 'left' }
    ]

    const result = applyPlanOps(nodes, edges, [
      {
        type: 'update-node',
        nodeId: 'a',
        nodeType: 'file-view',
        content: 'clusters/x.md',
        metadata: { section: 'a' }
      },
      {
        type: 'update-node',
        nodeId: 'b',
        nodeType: 'file-view',
        content: 'clusters/x.md',
        metadata: { section: 'b' }
      }
    ])
    expect(result.edges).toHaveLength(1)
  })
})
