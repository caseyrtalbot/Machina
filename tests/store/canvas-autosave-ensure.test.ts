import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DEFAULT_CANVAS_ID, getCanvasStore } from '../../src/renderer/src/store/canvas-store'
import { ensureCanvasAutosave } from '../../src/renderer/src/store/canvas-autosave'
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

// Separate file from canvas-autosave.test.ts on purpose: ensureCanvasAutosave
// wires an app-lifetime subscription with no teardown, which would double-watch
// stores in tests that manage subscribeCanvasAutosave() themselves.
describe('ensureCanvasAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()

    store.getState().loadCanvas('/test/canvas.json', {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('wires autosave once — repeated mounts do not stack watchers', async () => {
    ensureCanvasAutosave()
    ensureCanvasAutosave()
    ensureCanvasAutosave()

    store.getState().addNode(createCanvasNode('text', { x: 0, y: 0 }, { width: 200, height: 200 }))
    expect(store.getState().isDirty).toBe(true)

    vi.advanceTimersByTime(2000)
    await vi.advanceTimersByTimeAsync(0)

    expect(saveCanvas).toHaveBeenCalledTimes(1)
    expect(saveCanvas).toHaveBeenCalledWith('/test/canvas.json', expect.any(Object))
    expect(store.getState().isDirty).toBe(false)
  })

  it('keeps watching after further edits (no teardown between mounts)', async () => {
    ensureCanvasAutosave()

    store
      .getState()
      .addNode(createCanvasNode('text', { x: 50, y: 50 }, { width: 200, height: 200 }))
    vi.advanceTimersByTime(2000)
    await vi.advanceTimersByTimeAsync(0)
    expect(saveCanvas).toHaveBeenCalledTimes(1)

    store
      .getState()
      .addNode(createCanvasNode('text', { x: 300, y: 0 }, { width: 200, height: 200 }))
    vi.advanceTimersByTime(2000)
    await vi.advanceTimersByTimeAsync(0)
    expect(saveCanvas).toHaveBeenCalledTimes(2)
  })
})
