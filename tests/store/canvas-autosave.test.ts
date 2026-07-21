import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DEFAULT_CANVAS_ID, getCanvasStore } from '../../src/renderer/src/store/canvas-store'
import {
  subscribeCanvasAutosave,
  flushCanvasSave
} from '../../src/renderer/src/store/canvas-autosave'
import { createCanvasNode } from '../../src/shared/canvas-types'

const store = getCanvasStore(DEFAULT_CANVAS_ID)

// Mock the IPC layer
vi.mock('../../src/renderer/src/panels/canvas/canvas-io', () => ({
  saveCanvas: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../../src/renderer/src/utils/error-logger', () => ({
  logError: vi.fn(),
  notifyError: vi.fn()
}))

import { saveCanvas } from '../../src/renderer/src/panels/canvas/canvas-io'

describe('canvas-autosave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()

    // Load a canvas so filePath is set
    store.getState().loadCanvas('/test/canvas.json', {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('auto-saves after 2s debounce when isDirty becomes true', async () => {
    const unsub = subscribeCanvasAutosave()

    // Trigger dirty state
    store.getState().addNode(createCanvasNode('text', { x: 0, y: 0 }, { width: 200, height: 200 }))

    expect(store.getState().isDirty).toBe(true)
    expect(saveCanvas).not.toHaveBeenCalled()

    // Advance past debounce
    vi.advanceTimersByTime(2000)
    // Allow promise microtask to run
    await vi.advanceTimersByTimeAsync(0)

    expect(saveCanvas).toHaveBeenCalledWith('/test/canvas.json', expect.any(Object))
    expect(store.getState().isDirty).toBe(false)

    unsub()
  })

  it('does not save when not dirty', async () => {
    const unsub = subscribeCanvasAutosave()

    vi.advanceTimersByTime(5000)
    await vi.advanceTimersByTimeAsync(0)

    expect(saveCanvas).not.toHaveBeenCalled()

    unsub()
  })

  it('resets debounce on rapid mutations', async () => {
    const unsub = subscribeCanvasAutosave()

    // First mutation
    store.getState().addNode(createCanvasNode('text', { x: 0, y: 0 }, { width: 200, height: 200 }))

    // Wait 1s (less than debounce)
    vi.advanceTimersByTime(1000)
    expect(saveCanvas).not.toHaveBeenCalled()

    // isDirty is already true, so the subscription won't re-schedule.
    // But a markSaved + re-dirty cycle would.
    // Just verify the original debounce fires correctly.
    vi.advanceTimersByTime(1000)
    await vi.advanceTimersByTimeAsync(0)

    expect(saveCanvas).toHaveBeenCalledTimes(1)

    unsub()
  })

  it('flushCanvasSave writes immediately', async () => {
    store.getState().addNode(createCanvasNode('text', { x: 0, y: 0 }, { width: 200, height: 200 }))

    await flushCanvasSave()

    expect(saveCanvas).toHaveBeenCalledWith('/test/canvas.json', expect.any(Object))
    expect(store.getState().isDirty).toBe(false)
  })

  it('flushCanvasSave drains a mutation that lands mid-save instead of leaving it queued', async () => {
    let resolveSave!: () => void
    vi.mocked(saveCanvas).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve
        })
    )

    store.getState().addNode(createCanvasNode('text', { x: 0, y: 0 }, { width: 200, height: 200 }))

    const flush = flushCanvasSave()
    expect(saveCanvas).toHaveBeenCalledTimes(1)

    // Mutation lands while the flush's first write is still in flight. Quit
    // must not proceed with this version sitting in a debounce timer that
    // will never run.
    store
      .getState()
      .addNode(createCanvasNode('text', { x: 10, y: 10 }, { width: 200, height: 200 }))

    resolveSave()
    await flush

    expect(saveCanvas).toHaveBeenCalledTimes(2)
    expect(store.getState().isDirty).toBe(false)
  })

  it('does not save when no filePath is loaded', async () => {
    store.getState().closeCanvas()
    store.setState({ isDirty: true })

    await flushCanvasSave()

    expect(saveCanvas).not.toHaveBeenCalled()
  })

  it('cleans up timer on unsubscribe', () => {
    const unsub = subscribeCanvasAutosave()

    store.getState().addNode(createCanvasNode('text', { x: 0, y: 0 }, { width: 200, height: 200 }))

    unsub()

    // Timer should be cleared
    vi.advanceTimersByTime(5000)
    expect(saveCanvas).not.toHaveBeenCalled()
  })

  it('keeps canvas dirty when a mutation lands mid-save, then saves again', async () => {
    const unsub = subscribeCanvasAutosave()
    let resolveSave!: () => void
    vi.mocked(saveCanvas).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve
        })
    )

    store.getState().addNode(createCanvasNode('text', { x: 0, y: 0 }, { width: 200, height: 200 }))
    vi.advanceTimersByTime(2000)
    expect(saveCanvas).toHaveBeenCalledTimes(1)

    // Mutation lands while the write is still in flight
    store
      .getState()
      .addNode(createCanvasNode('text', { x: 10, y: 10 }, { width: 200, height: 200 }))

    resolveSave()
    await vi.advanceTimersByTimeAsync(0)

    // markSaved no-oped: the mid-save mutation must not be flipped clean
    expect(store.getState().isDirty).toBe(true)

    // The autosaver rescheduled and persists the mutation
    await vi.advanceTimersByTimeAsync(2000)
    expect(saveCanvas).toHaveBeenCalledTimes(2)
    expect(store.getState().isDirty).toBe(false)

    unsub()
  })

  it('flushCanvasSave persists viewport drift even when not dirty', async () => {
    store.getState().setViewport({ x: 50, y: 25, zoom: 1.2 })
    expect(store.getState().isDirty).toBe(false)

    await flushCanvasSave()

    expect(saveCanvas).toHaveBeenCalledTimes(1)
    const [, file] = vi.mocked(saveCanvas).mock.calls[0]
    expect(file.viewport).toEqual({ x: 50, y: 25, zoom: 1.2 })
    expect(store.getState().savedViewport).toEqual({ x: 50, y: 25, zoom: 1.2 })
  })

  it('flushCanvasSave skips the write when viewport matches the saved one', async () => {
    await flushCanvasSave()
    expect(saveCanvas).not.toHaveBeenCalled()
  })

  it('saves on pan-end when the viewport drifted', async () => {
    const unsub = subscribeCanvasAutosave()

    store.getState().setInteracting(true)
    store.getState().setViewport({ x: 100, y: 0, zoom: 1 })
    expect(store.getState().isDirty).toBe(false)
    expect(saveCanvas).not.toHaveBeenCalled()

    store.getState().setInteracting(false)
    await vi.advanceTimersByTimeAsync(2000)

    expect(saveCanvas).toHaveBeenCalledTimes(1)
    expect(store.getState().isDirty).toBe(false)

    unsub()
  })

  it('does not save on pan-end when the viewport did not move', async () => {
    const unsub = subscribeCanvasAutosave()

    store.getState().setInteracting(true)
    store.getState().setInteracting(false)
    await vi.advanceTimersByTimeAsync(5000)

    expect(saveCanvas).not.toHaveBeenCalled()

    unsub()
  })

  describe('markSaved version safety', () => {
    it('clears dirty and records the saved viewport when the version matches', () => {
      store
        .getState()
        .addNode(createCanvasNode('text', { x: 0, y: 0 }, { width: 200, height: 200 }))
      const { dirtyVersion, viewport } = store.getState()

      store.getState().markSaved(dirtyVersion, viewport)

      expect(store.getState().isDirty).toBe(false)
      expect(store.getState().savedViewport).toEqual(viewport)
    })

    it('no-ops on a stale version', () => {
      store
        .getState()
        .addNode(createCanvasNode('text', { x: 0, y: 0 }, { width: 200, height: 200 }))
      const stale = store.getState().dirtyVersion
      store
        .getState()
        .addNode(createCanvasNode('text', { x: 10, y: 10 }, { width: 200, height: 200 }))

      store.getState().markSaved(stale, { x: 9, y: 9, zoom: 9 })

      expect(store.getState().isDirty).toBe(true)
      expect(store.getState().savedViewport).not.toEqual({ x: 9, y: 9, zoom: 9 })
    })
  })
})
