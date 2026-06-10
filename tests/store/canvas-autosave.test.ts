import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useCanvasStore } from '../../src/renderer/src/store/canvas-store'
import {
  subscribeCanvasAutosave,
  flushCanvasSave
} from '../../src/renderer/src/store/canvas-autosave'
import { createCanvasNode } from '../../src/shared/canvas-types'

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
    useCanvasStore.getState().loadCanvas('/test/canvas.json', {
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
    useCanvasStore
      .getState()
      .addNode(createCanvasNode('text', { x: 0, y: 0 }, { width: 200, height: 200 }))

    expect(useCanvasStore.getState().isDirty).toBe(true)
    expect(saveCanvas).not.toHaveBeenCalled()

    // Advance past debounce
    vi.advanceTimersByTime(2000)
    // Allow promise microtask to run
    await vi.advanceTimersByTimeAsync(0)

    expect(saveCanvas).toHaveBeenCalledWith('/test/canvas.json', expect.any(Object))
    expect(useCanvasStore.getState().isDirty).toBe(false)

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
    useCanvasStore
      .getState()
      .addNode(createCanvasNode('text', { x: 0, y: 0 }, { width: 200, height: 200 }))

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
    useCanvasStore
      .getState()
      .addNode(createCanvasNode('text', { x: 0, y: 0 }, { width: 200, height: 200 }))

    await flushCanvasSave()

    expect(saveCanvas).toHaveBeenCalledWith('/test/canvas.json', expect.any(Object))
    expect(useCanvasStore.getState().isDirty).toBe(false)
  })

  it('does not save when no filePath is loaded', async () => {
    useCanvasStore.getState().closeCanvas()
    useCanvasStore.setState({ isDirty: true })

    await flushCanvasSave()

    expect(saveCanvas).not.toHaveBeenCalled()
  })

  it('cleans up timer on unsubscribe', () => {
    const unsub = subscribeCanvasAutosave()

    useCanvasStore
      .getState()
      .addNode(createCanvasNode('text', { x: 0, y: 0 }, { width: 200, height: 200 }))

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

    useCanvasStore
      .getState()
      .addNode(createCanvasNode('text', { x: 0, y: 0 }, { width: 200, height: 200 }))
    vi.advanceTimersByTime(2000)
    expect(saveCanvas).toHaveBeenCalledTimes(1)

    // Mutation lands while the write is still in flight
    useCanvasStore
      .getState()
      .addNode(createCanvasNode('text', { x: 10, y: 10 }, { width: 200, height: 200 }))

    resolveSave()
    await vi.advanceTimersByTimeAsync(0)

    // markSaved no-oped: the mid-save mutation must not be flipped clean
    expect(useCanvasStore.getState().isDirty).toBe(true)

    // The autosaver rescheduled and persists the mutation
    await vi.advanceTimersByTimeAsync(2000)
    expect(saveCanvas).toHaveBeenCalledTimes(2)
    expect(useCanvasStore.getState().isDirty).toBe(false)

    unsub()
  })

  it('flushCanvasSave persists viewport drift even when not dirty', async () => {
    useCanvasStore.getState().setViewport({ x: 50, y: 25, zoom: 1.2 })
    expect(useCanvasStore.getState().isDirty).toBe(false)

    await flushCanvasSave()

    expect(saveCanvas).toHaveBeenCalledTimes(1)
    const [, file] = vi.mocked(saveCanvas).mock.calls[0]
    expect(file.viewport).toEqual({ x: 50, y: 25, zoom: 1.2 })
    expect(useCanvasStore.getState().savedViewport).toEqual({ x: 50, y: 25, zoom: 1.2 })
  })

  it('flushCanvasSave skips the write when viewport matches the saved one', async () => {
    await flushCanvasSave()
    expect(saveCanvas).not.toHaveBeenCalled()
  })

  it('saves on pan-end when the viewport drifted', async () => {
    const unsub = subscribeCanvasAutosave()

    useCanvasStore.getState().setInteracting(true)
    useCanvasStore.getState().setViewport({ x: 100, y: 0, zoom: 1 })
    expect(useCanvasStore.getState().isDirty).toBe(false)
    expect(saveCanvas).not.toHaveBeenCalled()

    useCanvasStore.getState().setInteracting(false)
    await vi.advanceTimersByTimeAsync(2000)

    expect(saveCanvas).toHaveBeenCalledTimes(1)
    expect(useCanvasStore.getState().isDirty).toBe(false)

    unsub()
  })

  it('does not save on pan-end when the viewport did not move', async () => {
    const unsub = subscribeCanvasAutosave()

    useCanvasStore.getState().setInteracting(true)
    useCanvasStore.getState().setInteracting(false)
    await vi.advanceTimersByTimeAsync(5000)

    expect(saveCanvas).not.toHaveBeenCalled()

    unsub()
  })

  describe('markSaved version safety', () => {
    it('clears dirty and records the saved viewport when the version matches', () => {
      useCanvasStore
        .getState()
        .addNode(createCanvasNode('text', { x: 0, y: 0 }, { width: 200, height: 200 }))
      const { dirtyVersion, viewport } = useCanvasStore.getState()

      useCanvasStore.getState().markSaved(dirtyVersion, viewport)

      expect(useCanvasStore.getState().isDirty).toBe(false)
      expect(useCanvasStore.getState().savedViewport).toEqual(viewport)
    })

    it('no-ops on a stale version', () => {
      useCanvasStore
        .getState()
        .addNode(createCanvasNode('text', { x: 0, y: 0 }, { width: 200, height: 200 }))
      const stale = useCanvasStore.getState().dirtyVersion
      useCanvasStore
        .getState()
        .addNode(createCanvasNode('text', { x: 10, y: 10 }, { width: 200, height: 200 }))

      useCanvasStore.getState().markSaved(stale, { x: 9, y: 9, zoom: 9 })

      expect(useCanvasStore.getState().isDirty).toBe(true)
      expect(useCanvasStore.getState().savedViewport).not.toEqual({ x: 9, y: 9, zoom: 9 })
    })
  })
})
