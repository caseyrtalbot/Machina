import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { DEFAULT_CANVAS_ID, getCanvasStore } from '../../src/renderer/src/store/canvas-store'
import { createCanvasFile } from '../../src/shared/canvas-types'
import { useCanvasKeyboardShortcuts } from '../../src/renderer/src/panels/canvas/use-canvas-keyboard-shortcuts'
import { CommandStack } from '../../src/renderer/src/panels/canvas/canvas-commands'
import { CanvasStoreProvider } from '../../src/renderer/src/panels/canvas/canvas-store-context'

const store = getCanvasStore(DEFAULT_CANVAS_ID)

describe('focus-frames', () => {
  beforeEach(() => {
    store.setState(store.getInitialState())
  })

  it('saveFocusFrame stores current viewport', () => {
    store.getState().setViewport({ x: 100, y: 200, zoom: 1.5 })
    store.getState().saveFocusFrame('1')

    const frames = store.getState().focusFrames
    expect(frames['1']).toEqual({ x: 100, y: 200, zoom: 1.5 })
  })

  it('jumpToFocusFrame restores viewport', () => {
    store.getState().setViewport({ x: 100, y: 200, zoom: 1.5 })
    store.getState().saveFocusFrame('2')

    // Move viewport elsewhere
    store.getState().setViewport({ x: 0, y: 0, zoom: 1 })

    store.getState().jumpToFocusFrame('2')
    expect(store.getState().viewport).toEqual({ x: 100, y: 200, zoom: 1.5 })
  })

  it('jumpToFocusFrame does nothing for empty slot', () => {
    store.getState().setViewport({ x: 50, y: 60, zoom: 0.8 })
    store.getState().jumpToFocusFrame('3')
    expect(store.getState().viewport).toEqual({ x: 50, y: 60, zoom: 0.8 })
  })

  it('saveFocusFrame sets isDirty', () => {
    expect(store.getState().isDirty).toBe(false)
    store.getState().saveFocusFrame('1')
    expect(store.getState().isDirty).toBe(true)
  })

  it('jumpToFocusFrame does not set isDirty', () => {
    store.getState().saveFocusFrame('1')
    store.setState({ isDirty: false })

    store.getState().jumpToFocusFrame('1')
    expect(store.getState().isDirty).toBe(false)
  })

  it('toCanvasFile includes focusFrames', () => {
    store.getState().setViewport({ x: 10, y: 20, zoom: 2 })
    store.getState().saveFocusFrame('3')

    const file = store.getState().toCanvasFile()
    expect(file.focusFrames).toBeDefined()
    expect(file.focusFrames!['3']).toEqual({ x: 10, y: 20, zoom: 2 })
  })

  it('loadCanvas restores focusFrames from data', () => {
    const data = {
      ...createCanvasFile(),
      focusFrames: { '1': { x: 5, y: 10, zoom: 0.5 } }
    }
    store.getState().loadCanvas('/test.canvas', data)

    expect(store.getState().focusFrames).toEqual({
      '1': { x: 5, y: 10, zoom: 0.5 }
    })
  })

  it('loadCanvas defaults focusFrames to empty when absent', () => {
    const data = createCanvasFile()
    store.getState().loadCanvas('/test.canvas', data)

    expect(store.getState().focusFrames).toEqual({})
  })

  it('closeCanvas resets focusFrames to empty', () => {
    store.getState().saveFocusFrame('1')
    expect(Object.keys(store.getState().focusFrames).length).toBeGreaterThan(0)

    store.getState().closeCanvas()
    expect(store.getState().focusFrames).toEqual({})
  })

  it('clearFocusFrame removes the slot', () => {
    store.getState().setViewport({ x: 100, y: 200, zoom: 1.5 })
    store.getState().saveFocusFrame('1')
    store.getState().saveFocusFrame('2')

    store.getState().clearFocusFrame('1')

    expect(store.getState().focusFrames['1']).toBeUndefined()
    expect(store.getState().focusFrames['2']).toEqual({ x: 100, y: 200, zoom: 1.5 })
  })

  it('clearFocusFrame sets isDirty', () => {
    store.getState().saveFocusFrame('1')
    store.setState({ isDirty: false })

    store.getState().clearFocusFrame('1')

    expect(store.getState().isDirty).toBe(true)
  })

  it('clearFocusFrame is a no-op for an empty slot', () => {
    store.setState({ isDirty: false })
    store.getState().clearFocusFrame('4')
    expect(store.getState().isDirty).toBe(false)
    expect(store.getState().focusFrames['4']).toBeUndefined()
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
      return renderHook(
        () =>
          useCanvasKeyboardShortcuts({
            commandStack: { current: new CommandStack() },
            containerRef: { current: container },
            setImportOpen: () => {}
          }),
        {
          wrapper: ({ children }) => (
            <CanvasStoreProvider canvasId={DEFAULT_CANVAS_ID}>{children}</CanvasStoreProvider>
          )
        }
      )
    }

    it('Cmd+Shift+digit saves a frame even though macOS reports the shifted symbol in e.key', () => {
      const { unmount } = renderShortcuts()
      store.getState().setViewport({ x: 7, y: 8, zoom: 1.2 })

      // On macOS, Cmd+Shift+1 arrives as key '!' / code 'Digit1'.
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: '!', code: 'Digit1', metaKey: true, shiftKey: true })
      )

      expect(store.getState().focusFrames['1']).toEqual({ x: 7, y: 8, zoom: 1.2 })
      unmount()
    })

    it('Cmd+digit jumps to the saved frame', () => {
      const { unmount } = renderShortcuts()
      store.getState().setViewport({ x: 7, y: 8, zoom: 1.2 })
      store.getState().saveFocusFrame('2')
      store.getState().setViewport({ x: 0, y: 0, zoom: 1 })

      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: '2', code: 'Digit2', metaKey: true })
      )

      expect(store.getState().viewport).toEqual({ x: 7, y: 8, zoom: 1.2 })
      unmount()
    })
  })
})
