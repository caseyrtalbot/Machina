import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  DEFAULT_CANVAS_ID,
  getCanvasStore,
  getActiveCanvasId,
  setActiveCanvas,
  useCanvasStore
} from '../../src/renderer/src/store/canvas-store'
import {
  subscribeCanvasAutosave,
  flushCanvasSave
} from '../../src/renderer/src/store/canvas-autosave'
import { useThreadStore } from '../../src/renderer/src/store/thread-store'
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
  setActiveCanvas(DEFAULT_CANVAS_ID)
  const def = getCanvasStore(DEFAULT_CANVAS_ID)
  def.setState(def.getInitialState())
  useThreadStore.setState(useThreadStore.getInitialState())
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

  it('switching the active canvas redirects the proxy and preserves both states', () => {
    const a = getCanvasStore('switch-a')
    const b = getCanvasStore('switch-b')
    a.setState(a.getInitialState())
    b.setState(b.getInitialState())

    setActiveCanvas('switch-a')
    expect(getActiveCanvasId()).toBe('switch-a')
    useCanvasStore.getState().addNode(node(0, 0))
    useCanvasStore.getState().addNode(node(10, 10))

    setActiveCanvas('switch-b')
    expect(useCanvasStore.getState().nodes).toHaveLength(0)
    useCanvasStore.getState().addNode(node(50, 50))

    // Both canvases kept their own state across the switches.
    setActiveCanvas('switch-a')
    expect(useCanvasStore.getState().nodes).toHaveLength(2)
    expect(a.getState().nodes).toHaveLength(2)
    expect(b.getState().nodes).toHaveLength(1)
  })

  it('proxy subscribe follows active-canvas swaps', () => {
    const a = getCanvasStore('sub-a')
    const b = getCanvasStore('sub-b')
    a.setState(a.getInitialState())
    b.setState(b.getInitialState())
    b.getState().addNode(node())

    setActiveCanvas('sub-a')
    const listener = vi.fn()
    const unsub = useCanvasStore.subscribe(listener)

    // Swap notifies once so subscribers re-read the now-effective state.
    setActiveCanvas('sub-b')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0].nodes).toHaveLength(1)

    // After the swap, mutations on the new active instance notify too.
    b.getState().addNode(node(5, 5))
    expect(listener).toHaveBeenCalledTimes(2)

    // Mutations on the no-longer-active instance do not.
    a.getState().addNode(node(9, 9))
    expect(listener).toHaveBeenCalledTimes(2)

    unsub()
  })

  it('activating a canvas dock tab points the proxy at that canvas', () => {
    useThreadStore.setState({
      activeThreadId: 't1',
      dockTabsByThreadId: { t1: [{ kind: 'canvas', id: 'dock-x' }] }
    })
    useThreadStore.getState().setDockActiveIndex('t1', 0)
    expect(getActiveCanvasId()).toBe('dock-x')

    // A non-canvas tab keeps the last canvas active.
    useThreadStore.getState().addDockTab({ kind: 'graph' })
    expect(getActiveCanvasId()).toBe('dock-x')
  })
})

describe('multi-canvas autosave and quit-flush', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('a dirty non-active instance autosaves independently', async () => {
    const bg = getCanvasStore('autosave-bg')
    bg.setState(bg.getInitialState())
    bg.getState().loadCanvas('/test/autosave-bg.json', emptyFile())
    const unsub = subscribeCanvasAutosave()

    expect(getActiveCanvasId()).toBe(DEFAULT_CANVAS_ID)
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

  it('flushCanvasSave flushes every dirty instance, not just the active one', async () => {
    const a = getCanvasStore('flush-a')
    const b = getCanvasStore('flush-b')
    a.setState(a.getInitialState())
    b.setState(b.getInitialState())
    a.getState().loadCanvas('/test/flush-a.json', emptyFile())
    b.getState().loadCanvas('/test/flush-b.json', emptyFile())

    setActiveCanvas('flush-a')
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
