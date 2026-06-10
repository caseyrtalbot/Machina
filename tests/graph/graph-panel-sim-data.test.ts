import { describe, it, expect } from 'vitest'
import { prepareSimData } from '@renderer/panels/graph/GraphPanel'
import type { KnowledgeGraph } from '@shared/types'

const EMPTY = new Set<string>()

function makeGraph(): KnowledgeGraph {
  return {
    nodes: [
      {
        id: 'note-a',
        title: 'A',
        type: 'note',
        signal: 'untested',
        connectionCount: 2,
        origin: 'human'
      },
      { id: 'ghost-x', title: 'ghost-x', type: 'note', signal: 'untested', connectionCount: 1 },
      {
        id: 'note-b',
        title: 'B',
        type: 'note',
        signal: 'untested',
        connectionCount: 1,
        origin: 'agent'
      }
    ],
    edges: [
      { source: 'note-a', target: 'ghost-x', kind: 'connection' },
      { source: 'note-a', target: 'note-b', kind: 'connection' }
    ]
  }
}

describe('prepareSimData dismissal filtering', () => {
  it('keeps all nodes when nothing is dismissed', () => {
    const { simNodes, simEdges } = prepareSimData(makeGraph(), EMPTY)
    expect(simNodes.map((n) => n.id)).toEqual(['note-a', 'ghost-x', 'note-b'])
    expect(simEdges).toHaveLength(2)
  })

  it('excludes dismissed ghost nodes and their edges', () => {
    const { simNodes, simEdges } = prepareSimData(makeGraph(), new Set(['ghost-x']))

    expect(simNodes.map((n) => n.id)).toEqual(['note-a', 'note-b'])
    // Edge to the dismissed ghost is dropped; the note-to-note edge survives
    expect(simEdges).toHaveLength(1)
    expect(simEdges[0]).toMatchObject({ kind: 'connection' })
  })

  it('keeps indexes contiguous after filtering', () => {
    const { simNodes, nodeIndexMap } = prepareSimData(makeGraph(), new Set(['ghost-x']))

    simNodes.forEach((n, i) => expect(n.index).toBe(i))
    expect(nodeIndexMap.get('note-b')).toBe(1)
  })

  it('never filters real notes, even if their id is in the dismissed set', () => {
    // origin is set → not a ghost → dismissal must not hide it
    const { simNodes } = prepareSimData(makeGraph(), new Set(['note-a']))
    expect(simNodes.map((n) => n.id)).toContain('note-a')
  })
})
