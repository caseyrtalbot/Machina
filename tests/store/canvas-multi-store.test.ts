import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DEFAULT_CANVAS_ID, getCanvasStore } from '../../src/renderer/src/store/canvas-store'
import {
  subscribeCanvasAutosave,
  flushCanvasSave
} from '../../src/renderer/src/store/canvas-autosave'
import { useThreadStore } from '../../src/renderer/src/store/thread-store'
import { useDockStore, getFocusedCanvasId } from '../../src/renderer/src/store/dock-store'
import { createCanvasNode, type CanvasFile } from '../../src/shared/canvas-types'

// Mock the IPC layer
vi.mock('../../src/renderer/src/panels/canvas/canvas-io', () => ({
  saveCanvas: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../../src/renderer/src/utils/error-logger', () => ({
  logError: vi.fn(),
  notifyError: vi.fn()
}))

import { saveCanvas } from '../../src/renderer/src/panels/canvas/canvas-io'

function emptyFile(): CanvasFile {
  return { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
}

function node(x = 0, y = 0) {
  return createCanvasNode('text', { x, y }, { width: 200, height: 200 })
}

beforeEach(() => {
  vi.clearAllMocks()
  const def = getCanvasStore(DEFAULT_CANVAS_ID)
  def.setState(def.getInitialState())
  useThreadStore.setState(useThreadStore.getInitialState())
  useDockStore.setState(useDockStore.getInitialState())
})

describe('per-canvas store instances (3.8)', () => {
  it('two instances hold independent state', () => {
    const a = getCanvasStore('multi-a')
    const b = getCanvasStore('multi-b')
    expect(a).not.toBe(b)
    // Same id returns the same instance (state survives tab close/reopen).
    expect(getCanvasStore('multi-a')).toBe(a)

    const n = node()
    a.getState().addNode(n)

    expect(a.getState().nodes).toHaveLength(1)
    expect(b.getState().nodes).toHaveLength(0)
    expect(getCanvasStore(DEFAULT_CANVAS_ID).getState().nodes).toHaveLength(0)
  })
})

describe('focused canvas (Phase 1 step 1: no last-seen fallback)', () => {
  it('resolves the active canvas dock tab of the active thread', () => {
    useThreadStore.setState({ activeThreadId: 't1' })
    useDockStore.setState({ dockTabsByThreadId: { t1: [{ kind: 'canvas', id: 'dock-x' }] } })
    useDockStore.getState().setDockActiveIndex('t1', 0)
    expect(getFocusedCanvasId()).toBe('dock-x')
  })

  it('is null when a non-canvas tab is active — never the last-seen canvas', () => {
    useThreadStore.setState({ activeThreadId: 't1' })
    useDockStore.setState({ dockTabsByThreadId: { t1: [{ kind: 'canvas', id: 'dock-x' }] } })
    useDockStore.getState().setDockActiveIndex('t1', 0)
    expect(getFocusedCanvasId()).toBe('dock-x')

    // addDockTab activates the new (graph) tab.
    useDockStore.getState().addDockTab({ kind: 'graph' })
    expect(getFocusedCanvasId()).toBeNull()
  })

  it('is null with no active thread', () => {
    expect(getFocusedCanvasId()).toBeNull()
  })
})

describe('multi-canvas autosave and quit-flush', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('a dirty unfocused instance autosaves independently', async () => {
    const bg = getCanvasStore('autosave-bg')
    bg.setState(bg.getInitialState())
    bg.getState().loadCanvas('/test/autosave-bg.json', emptyFile())
    const unsub = subscribeCanvasAutosave()

    // No dock state at all: this canvas is not focused anywhere.
    expect(getFocusedCanvasId()).toBeNull()
    bg.getState().addNode(node())

    await vi.advanceTimersByTimeAsync(2000)
    expect(saveCanvas).toHaveBeenCalledWith('/test/autosave-bg.json', expect.any(Object))
    expect(bg.getState().isDirty).toBe(false)

    unsub()
  })

  it('instances created after subscription are watched too', async () => {
    const unsub = subscribeCanvasAutosave()
    const late = getCanvasStore('autosave-late')
    late.getState().loadCanvas('/test/autosave-late.json', emptyFile())
    late.getState().addNode(node())

    await vi.advanceTimersByTimeAsync(2000)
    expect(saveCanvas).toHaveBeenCalledWith('/test/autosave-late.json', expect.any(Object))

    unsub()
  })

  it('flushCanvasSave flushes every dirty instance, focused or not', async () => {
    const a = getCanvasStore('flush-a')
    const b = getCanvasStore('flush-b')
    a.setState(a.getInitialState())
    b.setState(b.getInitialState())
    a.getState().loadCanvas('/test/flush-a.json', emptyFile())
    b.getState().loadCanvas('/test/flush-b.json', emptyFile())

    a.getState().addNode(node())
    b.getState().addNode(node(20, 20))

    await flushCanvasSave()

    const paths = vi.mocked(saveCanvas).mock.calls.map(([p]) => p)
    expect(paths).toContain('/test/flush-a.json')
    expect(paths).toContain('/test/flush-b.json')
    expect(a.getState().isDirty).toBe(false)
    expect(b.getState().isDirty).toBe(false)
  })
})
