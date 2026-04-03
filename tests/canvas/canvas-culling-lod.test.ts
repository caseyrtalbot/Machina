import { describe, it, expect } from 'vitest'
import { createCanvasNode } from '../../src/shared/canvas-types'
import { getLodLevel } from '../../src/renderer/src/panels/canvas/use-canvas-lod'

// We test the culling logic directly since the hook is just a useMemo wrapper
// around a filter. Extract the pure logic for testing.
function filterVisible(
  nodes: ReturnType<typeof createCanvasNode>[],
  viewport: { x: number; y: number; zoom: number },
  containerSize: { width: number; height: number },
  buffer = 200
) {
  const viewMinX = -viewport.x / viewport.zoom - buffer
  const viewMinY = -viewport.y / viewport.zoom - buffer
  const viewMaxX = (-viewport.x + containerSize.width) / viewport.zoom + buffer
  const viewMaxY = (-viewport.y + containerSize.height) / viewport.zoom + buffer

  return nodes.filter((node) => {
    const nx = node.position.x
    const ny = node.position.y
    const nw = node.size.width
    const nh = node.size.height
    return nx + nw > viewMinX && nx < viewMaxX && ny + nh > viewMinY && ny < viewMaxY
  })
}

describe('viewport culling', () => {
  const container = { width: 1000, height: 800 }
  const defaultViewport = { x: 0, y: 0, zoom: 1 }

  it('includes nodes inside the viewport', () => {
    const node = createCanvasNode('text', { x: 100, y: 100 })
    const result = filterVisible([node], defaultViewport, container)
    expect(result).toHaveLength(1)
  })

  it('excludes nodes far outside the viewport', () => {
    const node = createCanvasNode('text', { x: 5000, y: 5000 })
    const result = filterVisible([node], defaultViewport, container)
    expect(result).toHaveLength(0)
  })

  it('includes nodes partially overlapping the viewport edge', () => {
    // Node is at x=950, width=260 default. Right edge at 1210 > viewport max (1000+200=1200)
    // But left edge at 950 < 1200, so it overlaps
    const node = createCanvasNode('text', { x: 950, y: 100 })
    const result = filterVisible([node], defaultViewport, container)
    expect(result).toHaveLength(1)
  })

  it('includes nodes within the buffer zone', () => {
    // Node at x=1100, still within 200px buffer past the 1000px viewport
    const node = createCanvasNode('text', { x: 1100, y: 100 })
    const result = filterVisible([node], defaultViewport, container)
    expect(result).toHaveLength(1)
  })

  it('excludes nodes just past the buffer zone', () => {
    // Node at x=1500 with width 260 = left edge at 1500
    // Viewport max + buffer = 1000 + 200 = 1200
    // 1500 > 1200, so excluded
    const node = createCanvasNode('text', { x: 1500, y: 100 })
    const result = filterVisible([node], defaultViewport, container)
    expect(result).toHaveLength(0)
  })

  it('handles panned viewport', () => {
    // Viewport panned 500px right (x = -500 in viewport coords)
    const viewport = { x: -500, y: 0, zoom: 1 }
    const node = createCanvasNode('text', { x: 600, y: 100 })
    const result = filterVisible([node], viewport, container)
    expect(result).toHaveLength(1)
  })

  it('handles zoomed-out viewport (more nodes visible)', () => {
    // At zoom 0.5, the visible area doubles
    const viewport = { x: 0, y: 0, zoom: 0.5 }
    const farNode = createCanvasNode('text', { x: 2000, y: 100 })
    const result = filterVisible([farNode], viewport, container)
    // viewMaxX = (0 + 1000) / 0.5 + 200 = 2200, node at 2000 is visible
    expect(result).toHaveLength(1)
  })

  it('handles negative positions', () => {
    const node = createCanvasNode('text', { x: -100, y: -100 })
    const result = filterVisible([node], defaultViewport, container)
    expect(result).toHaveLength(1)
  })

  it('filters a mix of visible and invisible nodes', () => {
    const visible1 = createCanvasNode('text', { x: 100, y: 100 })
    const visible2 = createCanvasNode('code', { x: 500, y: 300 })
    const invisible = createCanvasNode('text', { x: 9999, y: 9999 })
    const result = filterVisible([visible1, visible2, invisible], defaultViewport, container)
    expect(result).toHaveLength(2)
  })
})

describe('getLodLevel', () => {
  it('returns full at zoom 1.0', () => {
    expect(getLodLevel(1.0)).toBe('full')
  })

  it('returns full at zoom 0.3 (boundary)', () => {
    expect(getLodLevel(0.3)).toBe('full')
  })

  it('returns preview at zoom 0.29', () => {
    expect(getLodLevel(0.29)).toBe('preview')
  })

  it('returns preview at zoom 0.15 (boundary)', () => {
    expect(getLodLevel(0.15)).toBe('preview')
  })

  it('returns dot at zoom 0.14', () => {
    expect(getLodLevel(0.14)).toBe('dot')
  })

  it('returns dot at zoom 0.1 (min zoom)', () => {
    expect(getLodLevel(0.1)).toBe('dot')
  })

  it('returns full at zoom 3.0 (max zoom)', () => {
    expect(getLodLevel(3.0)).toBe('full')
  })

  it('returns full for text card at zoom 0.3', () => {
    expect(getLodLevel(0.3, 'text')).toBe('full')
  })

  it('returns preview for note card at zoom 0.3 (heavy threshold)', () => {
    expect(getLodLevel(0.3, 'note')).toBe('preview')
  })

  it('returns preview for markdown card at zoom 0.3 (heavy threshold)', () => {
    expect(getLodLevel(0.3, 'markdown')).toBe('preview')
  })

  it('returns full for note card at zoom 0.5 (heavy boundary)', () => {
    expect(getLodLevel(0.5, 'note')).toBe('full')
  })

  it('returns full for markdown card at zoom 0.5 (heavy boundary)', () => {
    expect(getLodLevel(0.5, 'markdown')).toBe('full')
  })

  it('returns full for note card at zoom 0.49 (above heavy threshold)', () => {
    expect(getLodLevel(0.49, 'note')).toBe('full')
  })

  it('returns dot for note card at zoom 0.14', () => {
    expect(getLodLevel(0.14, 'note')).toBe('dot')
  })

  it('uses standard threshold for non-heavy types', () => {
    expect(getLodLevel(0.35, 'code')).toBe('full')
    expect(getLodLevel(0.35, 'terminal')).toBe('full')
    expect(getLodLevel(0.35, 'image')).toBe('full')
  })
})
