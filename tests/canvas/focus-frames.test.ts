import { describe, it, expect, beforeEach } from 'vitest'
import { useCanvasStore } from '../../src/renderer/src/store/canvas-store'
import { createCanvasFile } from '../../src/shared/canvas-types'

describe('focus-frames', () => {
  beforeEach(() => {
    useCanvasStore.setState(useCanvasStore.getInitialState())
  })

  it('saveFocusFrame stores current viewport', () => {
    useCanvasStore.getState().setViewport({ x: 100, y: 200, zoom: 1.5 })
    useCanvasStore.getState().saveFocusFrame('1')

    const frames = useCanvasStore.getState().focusFrames
    expect(frames['1']).toEqual({ x: 100, y: 200, zoom: 1.5 })
  })

  it('jumpToFocusFrame restores viewport', () => {
    useCanvasStore.getState().setViewport({ x: 100, y: 200, zoom: 1.5 })
    useCanvasStore.getState().saveFocusFrame('2')

    // Move viewport elsewhere
    useCanvasStore.getState().setViewport({ x: 0, y: 0, zoom: 1 })

    useCanvasStore.getState().jumpToFocusFrame('2')
    expect(useCanvasStore.getState().viewport).toEqual({ x: 100, y: 200, zoom: 1.5 })
  })

  it('jumpToFocusFrame does nothing for empty slot', () => {
    useCanvasStore.getState().setViewport({ x: 50, y: 60, zoom: 0.8 })
    useCanvasStore.getState().jumpToFocusFrame('3')
    expect(useCanvasStore.getState().viewport).toEqual({ x: 50, y: 60, zoom: 0.8 })
  })

  it('saveFocusFrame sets isDirty', () => {
    expect(useCanvasStore.getState().isDirty).toBe(false)
    useCanvasStore.getState().saveFocusFrame('1')
    expect(useCanvasStore.getState().isDirty).toBe(true)
  })

  it('jumpToFocusFrame does not set isDirty', () => {
    useCanvasStore.getState().saveFocusFrame('1')
    useCanvasStore.setState({ isDirty: false })

    useCanvasStore.getState().jumpToFocusFrame('1')
    expect(useCanvasStore.getState().isDirty).toBe(false)
  })

  it('toCanvasFile includes focusFrames', () => {
    useCanvasStore.getState().setViewport({ x: 10, y: 20, zoom: 2 })
    useCanvasStore.getState().saveFocusFrame('3')

    const file = useCanvasStore.getState().toCanvasFile()
    expect(file.focusFrames).toBeDefined()
    expect(file.focusFrames!['3']).toEqual({ x: 10, y: 20, zoom: 2 })
  })

  it('loadCanvas restores focusFrames from data', () => {
    const data = {
      ...createCanvasFile(),
      focusFrames: { '1': { x: 5, y: 10, zoom: 0.5 } }
    }
    useCanvasStore.getState().loadCanvas('/test.canvas', data)

    expect(useCanvasStore.getState().focusFrames).toEqual({
      '1': { x: 5, y: 10, zoom: 0.5 }
    })
  })

  it('loadCanvas defaults focusFrames to empty when absent', () => {
    const data = createCanvasFile()
    useCanvasStore.getState().loadCanvas('/test.canvas', data)

    expect(useCanvasStore.getState().focusFrames).toEqual({})
  })

  it('closeCanvas resets focusFrames to empty', () => {
    useCanvasStore.getState().saveFocusFrame('1')
    expect(Object.keys(useCanvasStore.getState().focusFrames).length).toBeGreaterThan(0)

    useCanvasStore.getState().closeCanvas()
    expect(useCanvasStore.getState().focusFrames).toEqual({})
  })
})
