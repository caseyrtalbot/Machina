import { describe, it, expect } from 'vitest'
import { buildClusterDraft } from '../../src/renderer/src/panels/canvas/cluster-capture'
import type { CanvasNode, CanvasEdge } from '../../src/shared/canvas-types'

describe('buildClusterDraft — agent path', () => {
  it('excludes the root card from sections; prompt lives only in draft.prompt', () => {
    const root: CanvasNode = {
      id: 'root',
      type: 'text',
      position: { x: 0, y: 0 },
      size: { width: 300, height: 100 },
      content: 'Compare A and B',
      metadata: { origin: 'agent', title: 'Prompt: compare', cluster_id: 'c1' }
    }
    const childA: CanvasNode = {
      id: 'a',
      type: 'text',
      position: { x: 0, y: 200 },
      size: { width: 300, height: 100 },
      content: 'take a',
      metadata: { title: 'Take A' }
    }
    const childB: CanvasNode = {
      id: 'b',
      type: 'text',
      position: { x: 0, y: 400 },
      size: { width: 300, height: 100 },
      content: 'take b',
      metadata: { title: 'Take B' }
    }
    const edges: CanvasEdge[] = [
      { id: 'e1', fromNode: 'root', toNode: 'a', fromSide: 'bottom', toSide: 'top' },
      { id: 'e2', fromNode: 'root', toNode: 'b', fromSide: 'bottom', toSide: 'top' }
    ]

    const draft = buildClusterDraft('root', [], {
      nodes: [root, childA, childB],
      edges,
      agentSources: { c1: ['src-x'] }
    })

    expect(draft.kind).toBe('cluster')
    expect(draft.prompt).toBe('Compare A and B')
    expect(draft.origin).toBe('agent')
    expect(draft.sections.map((s) => s.cardId)).toEqual(['a', 'b'])
    expect(draft.sections.find((s) => s.cardId === 'root')).toBeUndefined()
  })
})
