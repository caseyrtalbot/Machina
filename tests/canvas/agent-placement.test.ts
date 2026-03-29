import { describe, it, expect } from 'vitest'
import {
  computeAgentPlacement,
  rectsOverlap
} from '../../src/renderer/src/panels/canvas/agent-placement'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeViewport(x = 0, y = 0, zoom = 1, width = 1200, height = 800) {
  return { x, y, zoom, width, height }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeAgentPlacement', () => {
  it('returns viewport center', () => {
    const viewport = makeViewport(0, 0, 1, 1200, 800)
    const result = computeAgentPlacement([], viewport)
    expect(result).toEqual({ x: 600, y: 400 })
  })

  it('accounts for zoom and offset when computing viewport center', () => {
    // viewport panned to (100, 200), zoomed to 2x
    // center = (100 + 1200 / (2*2), 200 + 800 / (2*2)) = (400, 400)
    const viewport = makeViewport(100, 200, 2, 1200, 800)
    const result = computeAgentPlacement([], viewport)
    expect(result).toEqual({ x: 400, y: 400 })
  })
})

describe('rectsOverlap', () => {
  it('returns true for overlapping rects', () => {
    const a = { x: 0, y: 0, w: 100, h: 100 }
    const b = { x: 50, y: 50, w: 100, h: 100 }
    expect(rectsOverlap(a, b)).toBe(true)
  })

  it('returns false for non-overlapping rects', () => {
    const a = { x: 0, y: 0, w: 100, h: 100 }
    const b = { x: 200, y: 200, w: 100, h: 100 }
    expect(rectsOverlap(a, b)).toBe(false)
  })

  it('returns false for touching edges (exactly adjacent)', () => {
    const a = { x: 0, y: 0, w: 100, h: 100 }
    const b = { x: 100, y: 0, w: 100, h: 100 }
    expect(rectsOverlap(a, b)).toBe(false)
  })

  it('returns true for fully contained rect', () => {
    const a = { x: 0, y: 0, w: 200, h: 200 }
    const b = { x: 50, y: 50, w: 50, h: 50 }
    expect(rectsOverlap(a, b)).toBe(true)
  })

  it('returns false for rects separated vertically', () => {
    const a = { x: 0, y: 0, w: 100, h: 100 }
    const b = { x: 0, y: 200, w: 100, h: 100 }
    expect(rectsOverlap(a, b)).toBe(false)
  })
})
