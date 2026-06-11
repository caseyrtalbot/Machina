import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useCanvasStore } from '../../src/renderer/src/store/canvas-store'
import { createCanvasFile } from '../../src/shared/canvas-types'
import { useCanvasKeyboardShortcuts } from '../../src/renderer/src/panels/canvas/use-canvas-keyboard-shortcuts'
import { CommandStack } from '../../src/renderer/src/panels/canvas/canvas-commands'

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

  it('clearFocusFrame removes the slot', () => {
    useCanvasStore.getState().setViewport({ x: 100, y: 200, zoom: 1.5 })
    useCanvasStore.getState().saveFocusFrame('1')
    useCanvasStore.getState().saveFocusFrame('2')

    useCanvasStore.getState().clearFocusFrame('1')

    expect(useCanvasStore.getState().focusFrames['1']).toBeUndefined()
    expect(useCanvasStore.getState().focusFrames['2']).toEqual({ x: 100, y: 200, zoom: 1.5 })
  })

  it('clearFocusFrame sets isDirty', () => {
    useCanvasStore.getState().saveFocusFrame('1')
    useCanvasStore.setState({ isDirty: false })

    useCanvasStore.getState().clearFocusFrame('1')

    expect(useCanvasStore.getState().isDirty).toBe(true)
  })

  it('clearFocusFrame is a no-op for an empty slot', () => {
    useCanvasStore.setState({ isDirty: false })
    useCanvasStore.getState().clearFocusFrame('4')
    expect(useCanvasStore.getState().isDirty).toBe(false)
    expect(useCanvasStore.getState().focusFrames['4']).toBeUndefined()
  })

  describe('keyboard shortcuts (handler-level)', () => {
    function renderShortcuts() {
      const container = document.createElement('div')
      // Non-zero rect so isCanvasHidden treats the canvas as visible.
      container.getBoundingClientRect = () =>
        ({
          width: 800,
          height: 600,
          top: 0,
          left: 0,
          right: 800,
          bottom: 600,
          x: 0,
          y: 0,
          toJSON: () => ({})
        }) as DOMRect
      document.body.appendChild(container)
      return renderHook(() =>
        useCanvasKeyboardShortcuts({
          commandStack: { current: new CommandStack() },
          containerRef: { current: container },
          setImportOpen: () => {}
        })
      )
    }

    it('Cmd+Shift+digit saves a frame even though macOS reports the shifted symbol in e.key', () => {
      const { unmount } = renderShortcuts()
      useCanvasStore.getState().setViewport({ x: 7, y: 8, zoom: 1.2 })

      // On macOS, Cmd+Shift+1 arrives as key '!' / code 'Digit1'.
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: '!', code: 'Digit1', metaKey: true, shiftKey: true })
      )

      expect(useCanvasStore.getState().focusFrames['1']).toEqual({ x: 7, y: 8, zoom: 1.2 })
      unmount()
    })

    it('Cmd+digit jumps to the saved frame', () => {
      const { unmount } = renderShortcuts()
      useCanvasStore.getState().setViewport({ x: 7, y: 8, zoom: 1.2 })
      useCanvasStore.getState().saveFocusFrame('2')
      useCanvasStore.getState().setViewport({ x: 0, y: 0, zoom: 1 })

      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: '2', code: 'Digit2', metaKey: true })
      )

      expect(useCanvasStore.getState().viewport).toEqual({ x: 7, y: 8, zoom: 1.2 })
      unmount()
    })
  })
})
