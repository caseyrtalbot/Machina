import { describe, expect, it } from 'vitest'
import {
  boundsVisibleOnAnyDisplay,
  captureWindowState,
  resolveInitialWindowState
} from '../window-state'

describe('window-state', () => {
  const displays = [{ workArea: { x: 0, y: 0, width: 1440, height: 900 } }]

  it('detects when saved bounds are visible on an attached display', () => {
    expect(boundsVisibleOnAnyDisplay({ x: 10, y: 10, width: 800, height: 600 }, displays)).toBe(
      true
    )
    expect(
      boundsVisibleOnAnyDisplay({ x: 5000, y: 5000, width: 800, height: 600 }, displays)
    ).toBe(false)
  })

  it('falls back when saved bounds are no longer visible', () => {
    expect(
      resolveInitialWindowState(
        { x: 5000, y: 5000, width: 900, height: 700 },
        displays,
        { width: 1280, height: 800 }
      )
    ).toEqual({ width: 1280, height: 800 })
  })

  it('preserves saved maximized state even when the previous display is gone', () => {
    expect(
      resolveInitialWindowState(
        { x: 5000, y: 5000, width: 900, height: 700, isMaximized: true },
        displays,
        { width: 1280, height: 800 }
      )
    ).toEqual({ x: 5000, y: 5000, width: 900, height: 700, isMaximized: true })
  })

  it('captures normal bounds and maximized state from the window', () => {
    expect(
      captureWindowState({
        getNormalBounds: () => ({ x: 20, y: 30, width: 1000, height: 700 }),
        isMaximized: () => true
      })
    ).toEqual({ x: 20, y: 30, width: 1000, height: 700, isMaximized: true })
  })
})
