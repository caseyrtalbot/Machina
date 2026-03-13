import { describe, it, expect } from 'vitest'
import { sortNodesAlphabetically, findNearestNeighbor } from '../../src/renderer/src/panels/graph/useGraphKeyboard'

describe('useGraphKeyboard helpers', () => {
  const nodes = [
    { id: 'c1', title: 'Constraint', x: 100, y: 200 },
    { id: 'g1', title: 'Alpha Gene', x: 0, y: 0 },
    { id: 'g2', title: 'Beta Gene', x: 200, y: 0 },
    { id: 'n1', title: 'Zeta Note', x: 300, y: 300 },
  ]
  const edges = [
    { source: 'g1', target: 'g2', kind: 'connection' as const },
    { source: 'g1', target: 'c1', kind: 'tension' as const },
  ]

  it('sorts nodes alphabetically by title', () => {
    const sorted = sortNodesAlphabetically(nodes)
    expect(sorted.map((n) => n.id)).toEqual(['g1', 'g2', 'c1', 'n1'])
  })

  it('finds nearest neighbor to the right', () => {
    const neighbor = findNearestNeighbor(nodes[1], nodes, edges, 'ArrowRight')
    expect(neighbor?.id).toBe('g2')
  })

  it('finds nearest neighbor downward', () => {
    const neighbor = findNearestNeighbor(nodes[1], nodes, edges, 'ArrowDown')
    expect(neighbor?.id).toBe('c1')
  })

  it('returns null when no neighbor in that direction', () => {
    const neighbor = findNearestNeighbor(nodes[1], nodes, edges, 'ArrowLeft')
    expect(neighbor).toBeNull()
  })
})
