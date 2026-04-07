import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  appWillQuitHandler: null as null | (() => Promise<void>),
  flushCanvasPromise: Promise.resolve(),
  flushPendingPromise: Promise.resolve()
}))

vi.mock('../canvas-autosave', () => ({
  flushCanvasSave: vi.fn(() => state.flushCanvasPromise)
}))

vi.mock('../editor-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../editor-store')>()
  return {
    ...actual,
    flushPendingSave: vi.fn(() => state.flushPendingPromise)
  }
})

import { registerQuitHandler, subscribeVaultPersist } from '../vault-persist'
import { useEditorStore } from '../editor-store'
import { useVaultStore } from '../vault-store'
import { useViewStore } from '../view-store'

function deferredPromise() {
  let resolve!: () => void
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('registerQuitHandler', () => {
  beforeEach(() => {
    state.appWillQuitHandler = null
    state.flushCanvasPromise = Promise.resolve()
    state.flushPendingPromise = Promise.resolve()

    const writeState = vi.fn(() => Promise.resolve())
    const quitReady = vi.fn()

    window.api = {
      vault: {
        writeState
      },
      lifecycle: {
        quitReady
      },
      on: {
        appWillQuit: vi.fn((handler: () => Promise<void>) => {
          state.appWillQuitHandler = handler
          return vi.fn()
        })
      }
    } as never

    useVaultStore.setState({
      vaultPath: '/vault',
      state: {
        version: 1,
        lastOpenNote: null,
        panelLayout: { sidebarWidth: 280 },
        contentView: 'editor',
        fileTreeCollapseState: {},
        selectedNodeId: null,
        recentFiles: []
      }
    })

    useEditorStore.setState({
      activeNotePath: '/vault/notes/hello.md',
      mode: 'rich',
      isDirty: false,
      content: '# Hello',
      cursorLine: 1,
      cursorCol: 1,
      openTabs: [],
      historyStack: [],
      historyIndex: -1
    })

    useViewStore.setState({ contentView: 'editor' })
  })

  it('waits for every flush before sending quitReady', async () => {
    const writeStateDeferred = deferredPromise()
    const flushCanvasDeferred = deferredPromise()
    const flushPendingDeferred = deferredPromise()

    window.api.vault.writeState = vi.fn(() => writeStateDeferred.promise)
    state.flushCanvasPromise = flushCanvasDeferred.promise
    state.flushPendingPromise = flushPendingDeferred.promise

    registerQuitHandler()

    const quitPromise = state.appWillQuitHandler?.()
    expect(window.api.lifecycle.quitReady).not.toHaveBeenCalled()

    writeStateDeferred.resolve()
    await Promise.resolve()
    expect(window.api.lifecycle.quitReady).not.toHaveBeenCalled()

    flushCanvasDeferred.resolve()
    await Promise.resolve()
    expect(window.api.lifecycle.quitReady).not.toHaveBeenCalled()

    flushPendingDeferred.resolve()
    await quitPromise

    expect(window.api.lifecycle.quitReady).toHaveBeenCalledTimes(1)
  })
})

describe('writePersist updates vault store', () => {
  beforeEach(() => {
    vi.useFakeTimers()

    const writeState = vi.fn(() => Promise.resolve())

    window.api = {
      vault: { writeState },
      lifecycle: { quitReady: vi.fn() },
      on: {
        appWillQuit: vi.fn(() => vi.fn())
      }
    } as never

    useVaultStore.setState({
      vaultPath: '/vault',
      state: {
        version: 1,
        lastOpenNote: null,
        panelLayout: { sidebarWidth: 280 },
        contentView: 'editor',
        fileTreeCollapseState: {},
        selectedNodeId: null,
        recentFiles: ['old-file.md']
      }
    })

    useEditorStore.setState({
      activeNotePath: '/vault/notes/hello.md',
      mode: 'rich',
      isDirty: false,
      content: '# Hello',
      cursorLine: 1,
      cursorCol: 1,
      openTabs: [],
      historyStack: ['/vault/notes/first.md', '/vault/notes/second.md', '/vault/notes/hello.md'],
      historyIndex: 2
    })

    useViewStore.setState({ contentView: 'editor' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('pushes gathered recentFiles into the vault store after persist', async () => {
    // Before persist, store still has the startup recentFiles
    expect(useVaultStore.getState().state?.recentFiles).toEqual(['old-file.md'])

    // Subscribe triggers schedulePersist on activeNotePath change
    const unsub = subscribeVaultPersist()

    // Trigger a persist cycle by changing the active note path
    useEditorStore.setState({ activeNotePath: '/vault/notes/new.md' })

    // Advance past the 1s debounce
    vi.advanceTimersByTime(1100)

    // Let the async writePersist settle
    await vi.advanceTimersByTimeAsync(0)

    const updatedState = useVaultStore.getState().state
    // recentFiles should reflect historyStack (newest-first), not the startup value
    expect(updatedState?.recentFiles).toContain('/vault/notes/hello.md')
    expect(updatedState?.recentFiles).toContain('/vault/notes/second.md')
    expect(updatedState?.recentFiles).toContain('/vault/notes/first.md')
    // The old startup entry should be preserved at the end (not in history)
    expect(updatedState?.recentFiles).toContain('old-file.md')
    // Newest from historyStack should be first
    expect(updatedState?.recentFiles?.[0]).toBe('/vault/notes/hello.md')

    unsub()
  })
})
