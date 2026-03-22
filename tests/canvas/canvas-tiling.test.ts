import { describe, it, expect } from 'vitest'
import {
  computeTileLayout,
  TILE_GAP,
  TILE_PATTERNS,
  type TilePattern
} from '../../src/renderer/src/panels/canvas/canvas-tiling'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCard(
  id: string,
  w = 280,
  h = 160
): { id: string; size: { width: number; height: number } } {
  return { id, size: { width: w, height: h } }
}

function hasOverlap(
  positions: Map<string, { x: number; y: number }>,
  cards: readonly { id: string; size: { width: number; height: number } }[]
): boolean {
  const rects = cards
    .filter((c) => positions.has(c.id))
    .map((c) => {
      const pos = positions.get(c.id)!
      return { x: pos.x, y: pos.y, w: c.size.width, h: c.size.height }
    })

  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]
      const b = rects[j]
      const overlapX = a.x < b.x + b.w && a.x + a.w > b.x
      const overlapY = a.y < b.y + b.h && a.y + a.h > b.y
      if (overlapX && overlapY) return true
    }
  }
  return false
}

function minGapBetweenCards(
  positions: Map<string, { x: number; y: number }>,
  cards: readonly { id: string; size: { width: number; height: number } }[]
): number {
  const rects = cards
    .filter((c) => positions.has(c.id))
    .map((c) => {
      const pos = positions.get(c.id)!
      return { x: pos.x, y: pos.y, w: c.size.width, h: c.size.height }
    })

  let minGap = Infinity

  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]
      const b = rects[j]

      // Horizontal gap (if they don't overlap vertically, no meaningful gap to measure)
      const overlapY = a.y < b.y + b.h && a.y + a.h > b.y
      const overlapX = a.x < b.x + b.w && a.x + a.w > b.x

      if (overlapY) {
        // Cards share vertical range — measure horizontal distance
        const hGap = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w))
        if (hGap >= 0) minGap = Math.min(minGap, hGap)
      }

      if (overlapX) {
        // Cards share horizontal range — measure vertical distance
        const vGap = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h))
        if (vGap >= 0) minGap = Math.min(minGap, vGap)
      }

      // If neither axis overlaps, measure edge-to-edge on the closer axis
      if (!overlapY && !overlapX) {
        const hGap = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w))
        const vGap = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h))
        minGap = Math.min(minGap, Math.max(hGap, vGap))
      }
    }
  }

  return minGap
}

// ---------------------------------------------------------------------------
// TILE_PATTERNS metadata
// ---------------------------------------------------------------------------

describe('TILE_PATTERNS', () => {
  it('contains all five patterns with labels', () => {
    expect(TILE_PATTERNS).toHaveLength(5)
    const ids = TILE_PATTERNS.map((p) => p.id)
    expect(ids).toContain('split-h')
    expect(ids).toContain('split-v')
    expect(ids).toContain('grid-2x2')
    expect(ids).toContain('main-sidebar')
    expect(ids).toContain('triple')
  })
})

// ---------------------------------------------------------------------------
// Empty input
// ---------------------------------------------------------------------------

describe('computeTileLayout - empty input', () => {
  it('returns empty Map when cards array is empty', () => {
    const result = computeTileLayout('split-h', { x: 500, y: 500 }, [])
    expect(result.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// split-h
// ---------------------------------------------------------------------------

describe('computeTileLayout - split-h', () => {
  const origin = { x: 500, y: 400 }

  it('places 2 cards side by side centered on origin', () => {
    const cards = [makeCard('a'), makeCard('b')]
    const result = computeTileLayout('split-h', origin, cards)

    expect(result.size).toBe(2)
    const posA = result.get('a')!
    const posB = result.get('b')!

    // Card A should be to the left of Card B
    expect(posA.x + cards[0].size.width + TILE_GAP).toBeCloseTo(posB.x, 5)

    // Layout should be centered on origin horizontally
    const totalWidth = cards[0].size.width + TILE_GAP + cards[1].size.width
    expect(posA.x).toBeCloseTo(origin.x - totalWidth / 2, 5)
  })

  it('centers a single card on origin', () => {
    const cards = [makeCard('solo', 300, 200)]
    const result = computeTileLayout('split-h', origin, cards)

    expect(result.size).toBe(1)
    const pos = result.get('solo')!
    expect(pos.x).toBeCloseTo(origin.x - 300 / 2, 5)
    expect(pos.y).toBeCloseTo(origin.y - 200 / 2, 5)
  })
})

// ---------------------------------------------------------------------------
// split-v
// ---------------------------------------------------------------------------

describe('computeTileLayout - split-v', () => {
  const origin = { x: 500, y: 400 }

  it('stacks 2 cards vertically centered on origin', () => {
    const cards = [makeCard('top', 280, 160), makeCard('bottom', 280, 160)]
    const result = computeTileLayout('split-v', origin, cards)

    expect(result.size).toBe(2)
    const posTop = result.get('top')!
    const posBottom = result.get('bottom')!

    // Top card should be above bottom card
    expect(posTop.y + cards[0].size.height + TILE_GAP).toBeCloseTo(posBottom.y, 5)

    // Layout should be centered on origin vertically
    const totalHeight = cards[0].size.height + TILE_GAP + cards[1].size.height
    expect(posTop.y).toBeCloseTo(origin.y - totalHeight / 2, 5)
  })
})

// ---------------------------------------------------------------------------
// grid-2x2
// ---------------------------------------------------------------------------

describe('computeTileLayout - grid-2x2', () => {
  const origin = { x: 600, y: 400 }

  it('places 4 cards in a 2x2 grid centered on origin', () => {
    const cards = [makeCard('tl'), makeCard('tr'), makeCard('bl'), makeCard('br')]
    const result = computeTileLayout('grid-2x2', origin, cards)

    expect(result.size).toBe(4)
    const posTL = result.get('tl')!
    const posTR = result.get('tr')!
    const posBL = result.get('bl')!
    const posBR = result.get('br')!

    // Top-left is above bottom-left
    expect(posTL.y).toBeLessThan(posBL.y)
    // Top-left is left of top-right
    expect(posTL.x).toBeLessThan(posTR.x)
    // Bottom-right is right of bottom-left
    expect(posBR.x).toBeGreaterThan(posBL.x)
    // Bottom-right is below top-right
    expect(posBR.y).toBeGreaterThan(posTR.y)
  })

  it('fills only 3 slots when given 3 cards', () => {
    const cards = [makeCard('a'), makeCard('b'), makeCard('c')]
    const result = computeTileLayout('grid-2x2', origin, cards)

    expect(result.size).toBe(3)
    expect(result.has('a')).toBe(true)
    expect(result.has('b')).toBe(true)
    expect(result.has('c')).toBe(true)
  })

  it('places 4 in grid and 2 in overflow when given 6 cards', () => {
    const cards = [
      makeCard('a'),
      makeCard('b'),
      makeCard('c'),
      makeCard('d'),
      makeCard('e'),
      makeCard('f')
    ]
    const result = computeTileLayout('grid-2x2', origin, cards)

    expect(result.size).toBe(6)

    // Overflow cards should be below the primary grid
    const primaryIds = ['a', 'b', 'c', 'd']
    const overflowIds = ['e', 'f']

    let maxPrimaryBottom = -Infinity
    for (const id of primaryIds) {
      const pos = result.get(id)!
      const card = cards.find((c) => c.id === id)!
      const bottom = pos.y + card.size.height
      if (bottom > maxPrimaryBottom) maxPrimaryBottom = bottom
    }

    for (const id of overflowIds) {
      const pos = result.get(id)!
      expect(pos.y).toBeGreaterThanOrEqual(maxPrimaryBottom + TILE_GAP)
    }
  })
})

// ---------------------------------------------------------------------------
// main-sidebar
// ---------------------------------------------------------------------------

describe('computeTileLayout - main-sidebar', () => {
  const origin = { x: 600, y: 400 }

  it('places main left and 2 sidebar cards stacked right', () => {
    const cards = [
      makeCard('main', 400, 340),
      makeCard('side-top', 240, 160),
      makeCard('side-bottom', 240, 160)
    ]
    const result = computeTileLayout('main-sidebar', origin, cards)

    expect(result.size).toBe(3)
    const posMain = result.get('main')!
    const posST = result.get('side-top')!
    const posSB = result.get('side-bottom')!

    // Main card is to the left of sidebar
    expect(posMain.x + cards[0].size.width + TILE_GAP).toBeCloseTo(posST.x, 5)
    // Sidebar top is above sidebar bottom
    expect(posST.y + cards[1].size.height + TILE_GAP).toBeCloseTo(posSB.y, 5)
    // Sidebar cards share the same x position
    expect(posST.x).toBeCloseTo(posSB.x, 5)
  })

  it('centers a single card on origin', () => {
    const cards = [makeCard('solo', 400, 300)]
    const result = computeTileLayout('main-sidebar', origin, cards)

    expect(result.size).toBe(1)
    const pos = result.get('solo')!
    expect(pos.x).toBeCloseTo(origin.x - 400 / 2, 5)
    expect(pos.y).toBeCloseTo(origin.y - 300 / 2, 5)
  })
})

// ---------------------------------------------------------------------------
// triple
// ---------------------------------------------------------------------------

describe('computeTileLayout - triple', () => {
  const origin = { x: 600, y: 400 }

  it('places 3 cards in a row centered on origin', () => {
    const cards = [makeCard('a'), makeCard('b'), makeCard('c')]
    const result = computeTileLayout('triple', origin, cards)

    expect(result.size).toBe(3)
    const posA = result.get('a')!
    const posB = result.get('b')!
    const posC = result.get('c')!

    // a is left of b, b is left of c
    expect(posA.x).toBeLessThan(posB.x)
    expect(posB.x).toBeLessThan(posC.x)

    // All share the same y
    expect(posA.y).toBeCloseTo(posB.y, 5)
    expect(posB.y).toBeCloseTo(posC.y, 5)
  })

  it('places 3 in pattern and 2 in overflow when given 5 cards', () => {
    const cards = [makeCard('a'), makeCard('b'), makeCard('c'), makeCard('d'), makeCard('e')]
    const result = computeTileLayout('triple', origin, cards)

    expect(result.size).toBe(5)

    // Overflow cards below the primary row
    const primaryIds = ['a', 'b', 'c']
    const overflowIds = ['d', 'e']

    let maxPrimaryBottom = -Infinity
    for (const id of primaryIds) {
      const pos = result.get(id)!
      const card = cards.find((c) => c.id === id)!
      const bottom = pos.y + card.size.height
      if (bottom > maxPrimaryBottom) maxPrimaryBottom = bottom
    }

    for (const id of overflowIds) {
      const pos = result.get(id)!
      expect(pos.y).toBeGreaterThanOrEqual(maxPrimaryBottom + TILE_GAP)
    }
  })
})

// ---------------------------------------------------------------------------
// No overlap — all patterns
// ---------------------------------------------------------------------------

describe('computeTileLayout - no overlap', () => {
  const origin = { x: 500, y: 500 }
  const patterns: TilePattern[] = ['split-h', 'split-v', 'grid-2x2', 'main-sidebar', 'triple']

  for (const pattern of patterns) {
    it(`${pattern}: positioned cards do not overlap`, () => {
      const cards = [
        makeCard('a', 280, 160),
        makeCard('b', 300, 180),
        makeCard('c', 260, 200),
        makeCard('d', 320, 140),
        makeCard('e', 240, 170)
      ]
      const result = computeTileLayout(pattern, origin, cards)
      expect(hasOverlap(result, cards)).toBe(false)
    })
  }
})

// ---------------------------------------------------------------------------
// Gap respected — all patterns with adjacent cards
// ---------------------------------------------------------------------------

describe('computeTileLayout - gap respected', () => {
  const origin = { x: 500, y: 500 }

  it('split-h: gap between adjacent cards is at least TILE_GAP', () => {
    const cards = [makeCard('a'), makeCard('b')]
    const result = computeTileLayout('split-h', origin, cards)
    expect(minGapBetweenCards(result, cards)).toBeGreaterThanOrEqual(TILE_GAP - 0.01)
  })

  it('split-v: gap between adjacent cards is at least TILE_GAP', () => {
    const cards = [makeCard('a'), makeCard('b')]
    const result = computeTileLayout('split-v', origin, cards)
    expect(minGapBetweenCards(result, cards)).toBeGreaterThanOrEqual(TILE_GAP - 0.01)
  })

  it('grid-2x2: gap between adjacent cards is at least TILE_GAP', () => {
    const cards = [makeCard('a'), makeCard('b'), makeCard('c'), makeCard('d')]
    const result = computeTileLayout('grid-2x2', origin, cards)
    expect(minGapBetweenCards(result, cards)).toBeGreaterThanOrEqual(TILE_GAP - 0.01)
  })

  it('main-sidebar: gap between adjacent cards is at least TILE_GAP', () => {
    const cards = [
      makeCard('main', 400, 340),
      makeCard('side-top', 240, 160),
      makeCard('side-bottom', 240, 160)
    ]
    const result = computeTileLayout('main-sidebar', origin, cards)
    expect(minGapBetweenCards(result, cards)).toBeGreaterThanOrEqual(TILE_GAP - 0.01)
  })

  it('triple: gap between adjacent cards is at least TILE_GAP', () => {
    const cards = [makeCard('a'), makeCard('b'), makeCard('c')]
    const result = computeTileLayout('triple', origin, cards)
    expect(minGapBetweenCards(result, cards)).toBeGreaterThanOrEqual(TILE_GAP - 0.01)
  })
})
