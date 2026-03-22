import { describe, it, expect } from 'vitest'
import {
  computeLineDelta,
  countLines
} from '../../src/renderer/src/panels/canvas/shared/file-view-utils'
import { getDefaultMetadata, getMinSize, getDefaultSize } from '../../src/shared/canvas-types'

// ---------------------------------------------------------------------------
// countLines
// ---------------------------------------------------------------------------

describe('countLines', () => {
  it('returns 0 for empty string', () => {
    expect(countLines('')).toBe(0)
  })

  it('returns 1 for a single line without newline', () => {
    expect(countLines('hello')).toBe(1)
  })

  it('returns 3 for three lines', () => {
    expect(countLines('a\nb\nc')).toBe(3)
  })

  it('counts trailing newline as an extra line', () => {
    // "a\nb\n" splits into ["a", "b", ""], which is 3 entries
    expect(countLines('a\nb\n')).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// computeLineDelta
// ---------------------------------------------------------------------------

describe('computeLineDelta', () => {
  it('shows positive delta when lines are added', () => {
    // 0 previous lines, content with 100 lines
    const content = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n')
    const result = computeLineDelta(0, content)
    expect(result.display).toBe('+100')
    expect(result.added).toBe(100)
    expect(result.removed).toBe(0)
  })

  it('shows negative delta when lines are removed', () => {
    // 100 previous lines, content now has 1 line
    const result = computeLineDelta(100, 'single line')
    expect(result.display).toBe('-99')
    expect(result.added).toBe(0)
    expect(result.removed).toBe(99)
  })

  it('shows "modified" when line count is unchanged', () => {
    // 50 previous lines, content still has 50 lines
    const content = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n')
    const result = computeLineDelta(50, content)
    expect(result.display).toBe('modified')
    expect(result.added).toBe(0)
    expect(result.removed).toBe(0)
  })

  it('shows small positive delta', () => {
    // 10 -> 15 lines
    const content = Array.from({ length: 15 }, (_, i) => `line ${i}`).join('\n')
    const result = computeLineDelta(10, content)
    expect(result.display).toBe('+5')
    expect(result.added).toBe(5)
  })

  it('shows small negative delta', () => {
    // 20 -> 12 lines
    const content = Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n')
    const result = computeLineDelta(20, content)
    expect(result.display).toBe('-8')
    expect(result.removed).toBe(8)
  })

  it('handles empty content with 0 previous lines', () => {
    // Note: "".split('\n').length === 1, so delta is +1 from 0
    // This is an edge case of the split-based counting
    const result = computeLineDelta(0, '')
    expect(result.display).toBe('+1')
  })

  it('handles empty content with non-zero previous lines', () => {
    // "".split('\n').length === 1, so delta is 1 - 50 = -49
    const result = computeLineDelta(50, '')
    expect(result.display).toBe('-49')
  })
})

// ---------------------------------------------------------------------------
// Type registration: file-view defaults and sizes
// ---------------------------------------------------------------------------

describe('file-view type registration', () => {
  it('returns correct default metadata for file-view', () => {
    const meta = getDefaultMetadata('file-view')
    expect(meta).toEqual({
      language: 'plaintext',
      previousLineCount: 0,
      modified: false
    })
  })

  it('returns minimum size for file-view', () => {
    const size = getMinSize('file-view')
    expect(size).toEqual({ width: 300, height: 200 })
  })

  it('returns default size for file-view', () => {
    const size = getDefaultSize('file-view')
    expect(size).toEqual({ width: 480, height: 320 })
  })
})
