import { describe, it, expect } from 'vitest'
import { snapToGrid, SNAP_GRID_SIZE } from '../../src/renderer/src/panels/canvas/use-canvas-drag'
import { VALID_CONVERSIONS } from '../../src/renderer/src/panels/canvas/CardShell'
import type { CanvasNodeType } from '../../src/shared/canvas-types'

describe('snap-to-grid', () => {
  it('snaps to nearest 24px multiple', () => {
    expect(snapToGrid(0, SNAP_GRID_SIZE)).toBe(0)
    expect(snapToGrid(12, SNAP_GRID_SIZE)).toBe(24)
    expect(snapToGrid(11, SNAP_GRID_SIZE)).toBe(0)
    expect(snapToGrid(24, SNAP_GRID_SIZE)).toBe(24)
    expect(snapToGrid(36, SNAP_GRID_SIZE)).toBe(48)
    expect(snapToGrid(47, SNAP_GRID_SIZE)).toBe(48)
    expect(snapToGrid(49, SNAP_GRID_SIZE)).toBe(48)
  })

  it('handles negative values', () => {
    // Math.round rounds halves toward +Infinity: round(-0.5) = 0, round(-1.5) = -1
    expect(snapToGrid(-12, SNAP_GRID_SIZE)).toBe(0)
    expect(snapToGrid(-13, SNAP_GRID_SIZE)).toBe(-24)
    expect(snapToGrid(-24, SNAP_GRID_SIZE)).toBe(-24)
    expect(snapToGrid(-36, SNAP_GRID_SIZE)).toBe(-24)
    expect(snapToGrid(-37, SNAP_GRID_SIZE)).toBe(-48)
  })

  it('uses correct grid size of 24', () => {
    expect(SNAP_GRID_SIZE).toBe(24)
  })
})

describe('card conversions', () => {
  const ALL_TYPES: CanvasNodeType[] = ['text', 'code', 'markdown', 'note', 'image', 'terminal']

  it('text converts to code, markdown, terminal', () => {
    expect(VALID_CONVERSIONS.text).toEqual(['code', 'markdown', 'terminal'])
  })

  it('code converts to text, markdown, terminal', () => {
    expect(VALID_CONVERSIONS.code).toEqual(['text', 'markdown', 'terminal'])
  })

  it('markdown converts to text, code, terminal', () => {
    expect(VALID_CONVERSIONS.markdown).toEqual(['text', 'code', 'terminal'])
  })

  it('note converts to markdown, terminal', () => {
    expect(VALID_CONVERSIONS.note).toEqual(['markdown', 'terminal'])
  })

  it('image converts to text, terminal', () => {
    expect(VALID_CONVERSIONS.image).toEqual(['text', 'terminal'])
  })

  it('terminal converts to text', () => {
    expect(VALID_CONVERSIONS.terminal).toEqual(['text'])
  })

  it('never includes current type in conversion targets', () => {
    for (const type of ALL_TYPES) {
      expect(VALID_CONVERSIONS[type]).not.toContain(type)
    }
  })

  it('every type has at least one conversion target', () => {
    for (const type of ALL_TYPES) {
      expect(VALID_CONVERSIONS[type].length).toBeGreaterThan(0)
    }
  })

  it('all conversion targets are valid CanvasNodeTypes', () => {
    for (const type of ALL_TYPES) {
      for (const target of VALID_CONVERSIONS[type]) {
        expect(ALL_TYPES).toContain(target)
      }
    }
  })
})
