import { describe, it, expect } from 'vitest'
import { diffNodes, detectRenames } from '../../src/renderer/src/panels/graph/useGraphAnimation'
import type { SimNode } from '../../src/renderer/src/panels/graph/GraphRenderer'

function makeNode(id: string, title: string = id, x: number = 0, y: number = 0): SimNode {
  return { id, title, type: 'note', signal: 'untested', connectionCount: 0, x, y }
}

// ---------------------------------------------------------------------------
// diffNodes
// ---------------------------------------------------------------------------

describe('diffNodes', () => {
  it('detects added nodes', () => {
    const prev = [makeNode('a')]
    const next = [makeNode('a'), makeNode('b')]
    const result = diffNodes(prev, next)

    expect(result.added.map((n) => n.id)).toEqual(['b'])
    expect(result.kept.map((n) => n.id)).toEqual(['a'])
    expect(result.removed).toHaveLength(0)
  })

  it('detects removed nodes', () => {
    const prev = [makeNode('a'), makeNode('b')]
    const next = [makeNode('a')]
    const result = diffNodes(prev, next)

    expect(result.removed.map((n) => n.id)).toEqual(['b'])
    expect(result.kept.map((n) => n.id)).toEqual(['a'])
    expect(result.added).toHaveLength(0)
  })

  it('handles empty arrays', () => {
    const result = diffNodes([], [])

    expect(result.added).toHaveLength(0)
    expect(result.removed).toHaveLength(0)
    expect(result.kept).toHaveLength(0)
  })

  it('detects simultaneous adds and removes', () => {
    const prev = [makeNode('a'), makeNode('b')]
    const next = [makeNode('a'), makeNode('c')]
    const result = diffNodes(prev, next)

    expect(result.added.map((n) => n.id)).toEqual(['c'])
    expect(result.removed.map((n) => n.id)).toEqual(['b'])
    expect(result.kept.map((n) => n.id)).toEqual(['a'])
  })
})

// ---------------------------------------------------------------------------
// detectRenames
// ---------------------------------------------------------------------------

describe('detectRenames', () => {
  it('matches a remove+add with the same id as a rename', () => {
    const removed = [makeNode('x', 'x', 10, 20)]
    const added = [makeNode('x', 'x renamed')]
    const result = detectRenames(removed, added)

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ id: 'x', oldX: 10, oldY: 20 })
  })

  it('returns empty when no matching IDs', () => {
    const removed = [makeNode('a')]
    const added = [makeNode('b')]
    const result = detectRenames(removed, added)

    expect(result).toHaveLength(0)
  })

  it('handles multiple renames', () => {
    const removed = [makeNode('x', 'x', 5, 10), makeNode('y', 'y', 15, 25)]
    const added = [makeNode('x', 'x new'), makeNode('y', 'y new')]
    const result = detectRenames(removed, added)

    expect(result).toHaveLength(2)
    const byId = Object.fromEntries(result.map((r) => [r.id, r]))
    expect(byId['x']).toEqual({ id: 'x', oldX: 5, oldY: 10 })
    expect(byId['y']).toEqual({ id: 'y', oldX: 15, oldY: 25 })
  })
})
