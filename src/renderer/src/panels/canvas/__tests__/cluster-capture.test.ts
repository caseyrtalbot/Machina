import { describe, it, expect } from 'vitest'
import { buildClusterDraft } from '../cluster-capture'
import type { CanvasNode, CanvasEdge } from '@shared/canvas-types'

function node(
  id: string,
  title: string,
  x: number,
  y: number,
  meta: Record<string, unknown> = {}
): CanvasNode {
  return {
    id,
    type: 'text',
    position: { x, y },
    size: { width: 200, height: 100 },
    content: `body-${id}`,
    metadata: { title, ...meta }
  }
}

function edge(id: string, from: string, to: string): CanvasEdge {
  return { id, fromNode: from, toNode: to, fromSide: 'bottom', toSide: 'top' }
}

describe('buildClusterDraft (agent-run path)', () => {
  it('collects the root + connected children, ordered top-to-bottom', () => {
    const root = node('root', 'Prompt: compare X and Y', 0, 0, {
      cluster_id: 'cl-1',
      origin: 'agent'
    })
    const a = node('a', 'X', 0, 200)
    const b = node('b', 'Y', 300, 200)
    const c = node('c', 'Synthesis', 150, 400)

    const draft = buildClusterDraft('root', [], {
      nodes: [root, a, b, c],
      edges: [
        edge('e1', 'root', 'a'),
        edge('e2', 'root', 'b'),
        edge('e3', 'a', 'c'),
        edge('e4', 'b', 'c')
      ],
      agentSources: { 'cl-1': ['src-1', 'src-2'] }
    })

    expect(draft.kind).toBe('cluster')
    expect(draft.origin).toBe('agent')
    expect(draft.title).toBe('Prompt: compare X and Y')
    expect(draft.prompt).toBe('body-root')
    expect(draft.sources).toEqual(['src-1', 'src-2'])
    expect(draft.sections.map((s) => s.cardId)).toEqual(['a', 'b', 'c'])
    expect(draft.sections[0].heading).toBe('X')
  })
})

describe('buildClusterDraft (ad-hoc path)', () => {
  it('uses the selection as the cluster in top-to-bottom order', () => {
    const a = node('a', 'A', 100, 200)
    const b = node('b', 'B', 100, 50)
    const c = node('c', 'C', 100, 400)

    const draft = buildClusterDraft(null, ['a', 'b', 'c'], {
      nodes: [a, b, c],
      edges: [],
      agentSources: {},
      userTitle: 'Manual cluster'
    })

    expect(draft.origin).toBe('human')
    expect(draft.prompt).toBe('')
    expect(draft.title).toBe('Manual cluster')
    expect(draft.sections.map((s) => s.cardId)).toEqual(['b', 'a', 'c'])
  })

  it('falls back to "Section N" when a card has no title', () => {
    const a = node('a', '', 0, 0)
    const b = node('b', '', 0, 100)
    const draft = buildClusterDraft(null, ['a', 'b'], {
      nodes: [a, b],
      edges: [],
      agentSources: {},
      userTitle: 'Untitled'
    })
    expect(draft.sections[0].heading).toBe('Section 1')
    expect(draft.sections[1].heading).toBe('Section 2')
  })
})
