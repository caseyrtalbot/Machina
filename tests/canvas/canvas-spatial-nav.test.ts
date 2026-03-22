import { describe, it, expect } from 'vitest'
import {
  spatialSort,
  nextCard,
  prevCard,
  ROW_BUCKET_THRESHOLD
} from '../../src/renderer/src/panels/canvas/canvas-spatial-nav'
import type { CanvasNode } from '../../src/shared/canvas-types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(id: string, x: number, y: number, w = 280, h = 160): CanvasNode {
  return {
    id,
    type: 'text',
    position: { x, y },
    size: { width: w, height: h },
    content: '',
    metadata: {}
  }
}

// ---------------------------------------------------------------------------
// spatialSort
// ---------------------------------------------------------------------------

describe('spatialSort', () => {
  it('sorts a horizontal row left-to-right', () => {
    const nodes = [makeNode('c', 600, 0), makeNode('a', 0, 0), makeNode('b', 300, 0)]
    expect(spatialSort(nodes)).toEqual(['a', 'b', 'c'])
  })

  it('sorts a vertical column top-to-bottom', () => {
    const nodes = [makeNode('bottom', 0, 400), makeNode('top', 0, 0), makeNode('mid', 0, 200)]
    expect(spatialSort(nodes)).toEqual(['top', 'mid', 'bottom'])
  })

  it('sorts a mixed 2x2 grid: row 1 left-to-right, then row 2', () => {
    const nodes = [
      makeNode('d', 300, 300),
      makeNode('b', 300, 0),
      makeNode('c', 0, 300),
      makeNode('a', 0, 0)
    ]
    expect(spatialSort(nodes)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('buckets nodes within ROW_BUCKET_THRESHOLD into the same row', () => {
    // Node B is 10px lower in y than A — well within the 80px threshold.
    // B is to the left of A, so if bucketed into the same row, B comes first.
    const nodes = [makeNode('a', 400, 100), makeNode('b', 100, 110)]
    expect(spatialSort(nodes)).toEqual(['b', 'a'])
  })

  it('keeps nodes at exactly ROW_BUCKET_THRESHOLD in the same row', () => {
    // center-y of A: 0 + 160/2 = 80
    // center-y of B: ROW_BUCKET_THRESHOLD + 160/2 = 80 + 80 = 160
    // difference = 80 = ROW_BUCKET_THRESHOLD (not MORE than), so same row
    const nodes = [makeNode('right', 300, 0), makeNode('left', 0, ROW_BUCKET_THRESHOLD)]
    expect(spatialSort(nodes)).toEqual(['left', 'right'])
  })

  it('splits nodes 1px beyond ROW_BUCKET_THRESHOLD into different rows', () => {
    // center-y of A: 0 + 160/2 = 80
    // center-y of B: (ROW_BUCKET_THRESHOLD + 1) + 160/2 = 81 + 80 = 161
    // difference = 81 > ROW_BUCKET_THRESHOLD, so different rows
    const nodes = [makeNode('row2', 0, ROW_BUCKET_THRESHOLD + 1), makeNode('row1', 300, 0)]
    expect(spatialSort(nodes)).toEqual(['row1', 'row2'])
  })

  it('returns a single-element array for one node', () => {
    const nodes = [makeNode('solo', 50, 50)]
    expect(spatialSort(nodes)).toEqual(['solo'])
  })

  it('returns an empty array for no nodes', () => {
    expect(spatialSort([])).toEqual([])
  })

  it('breaks ties on same center-y and center-x by ID', () => {
    // Identical positions and sizes — only ID differs
    const nodes = [
      makeNode('z', 100, 100, 200, 200),
      makeNode('a', 100, 100, 200, 200),
      makeNode('m', 100, 100, 200, 200)
    ]
    expect(spatialSort(nodes)).toEqual(['a', 'm', 'z'])
  })
})

// ---------------------------------------------------------------------------
// nextCard
// ---------------------------------------------------------------------------

describe('nextCard', () => {
  const ids = ['a', 'b', 'c']

  it('advances to the next ID in the list', () => {
    expect(nextCard(ids, 'a')).toBe('b')
    expect(nextCard(ids, 'b')).toBe('c')
  })

  it('wraps from last to first', () => {
    expect(nextCard(ids, 'c')).toBe('a')
  })

  it('returns the first ID when currentId is null', () => {
    expect(nextCard(ids, null)).toBe('a')
  })

  it('returns the first ID when currentId is not found', () => {
    expect(nextCard(ids, 'unknown')).toBe('a')
  })

  it('returns null for an empty list', () => {
    expect(nextCard([], 'a')).toBeNull()
    expect(nextCard([], null)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// prevCard
// ---------------------------------------------------------------------------

describe('prevCard', () => {
  const ids = ['a', 'b', 'c']

  it('retreats to the previous ID in the list', () => {
    expect(prevCard(ids, 'c')).toBe('b')
    expect(prevCard(ids, 'b')).toBe('a')
  })

  it('wraps from first to last', () => {
    expect(prevCard(ids, 'a')).toBe('c')
  })

  it('returns the last ID when currentId is null', () => {
    expect(prevCard(ids, null)).toBe('c')
  })

  it('returns the last ID when currentId is not found', () => {
    expect(prevCard(ids, 'unknown')).toBe('c')
  })

  it('returns null for an empty list', () => {
    expect(prevCard([], 'a')).toBeNull()
    expect(prevCard([], null)).toBeNull()
  })
})
