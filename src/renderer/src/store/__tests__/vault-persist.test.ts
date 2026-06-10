import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Thread } from '@shared/thread-types'

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

import { registerQuitHandler, subscribeVaultPersist, flushVaultState } from '../vault-persist'
import { useEditorStore } from '../editor-store'
import { useVaultStore } from '../vault-store'
import { useThreadStore } from '../thread-store'
import { useUiStore } from '../ui-store'

const sampleThread = (id: string): Thread => ({
  id,
  agent: 'machina-native',
  model: 'claude-sonnet-4-6',
  started: '2026-05-01T13:00:00Z',
  lastMessage: '2026-05-01T13:00:00Z',
  title: 'Sample',
  dockState: { tabs: [] },
  messages: []
})

function deferredPromise() {
  let resolve!: () => void
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function installApi(): void {
  window.api = {
    vault: {
      writeState: vi.fn(() => Promise.resolve())
    },
    thread: {
      save: vi.fn(() => Promise.resolve())
    },
    lifecycle: {
      quitReady: vi.fn()
    },
    on: {
      appWillQuit: vi.fn((handler: () => Promise<void>) => {
        state.appWillQuitHandler = handler
        return vi.fn()
      })
    }
  } as never
}

describe('registerQuitHandler', () => {
  beforeEach(() => {
    state.appWillQuitHandler = null
    state.flushCanvasPromise = Promise.resolve()
    state.flushPendingPromise = Promise.resolve()
    installApi()

    useThreadStore.setState(useThreadStore.getInitialState())
    useUiStore.setState(useUiStore.getInitialState())

    useVaultStore.setState({
      vaultPath: '/vault',
      state: {
        version: 1,
        lastOpenNote: null,
        fileTreeCollapseState: {}
      }
    })

    useEditorStore.setState({
      activeNotePath: '/vault/notes/hello.md',
      mode: 'rich',
      isDirty: false,
      content: '# Hello',
      openTabs: [],
      historyStack: [],
      historyIndex: -1
    })
  })

  it('waits for every flush before sending quitReady', async () => {
    const writeStateDeferred = deferredPromise()
    const flushCanvasDeferred = deferredPromise()
    const flushPendingDeferred = deferredPromise()
    const threadSaveDeferred = deferredPromise()

    window.api.vault.writeState = vi.fn(() => writeStateDeferred.promise)
    window.api.thread.save = vi.fn(() => threadSaveDeferred.promise) as never
    state.flushCanvasPromise = flushCanvasDeferred.promise
    state.flushPendingPromise = flushPendingDeferred.promise

    useThreadStore.setState({
      vaultPath: '/vault',
      activeThreadId: 'a',
      threadsById: { a: sampleThread('a') },
      dockTabsByThreadId: { a: [{ kind: 'graph' }] }
    })

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
    await Promise.resolve()
    await Promise.resolve()
    expect(window.api.lifecycle.quitReady).not.toHaveBeenCalled()

    threadSaveDeferred.resolve()
    await quitPromise

    expect(window.api.lifecycle.quitReady).toHaveBeenCalledTimes(1)
  })

  it('flushes the active thread dock tabs on quit', async () => {
    useThreadStore.setState({
      vaultPath: '/vault',
      activeThreadId: 'a',
      threadsById: { a: sampleThread('a') },
      dockTabsByThreadId: { a: [{ kind: 'graph' }, { kind: 'editor', path: '/vault/n.md' }] }
    })

    registerQuitHandler()
    await state.appWillQuitHandler?.()

    expect(window.api.thread.save).toHaveBeenCalledTimes(1)
    const saved = (window.api.thread.save as ReturnType<typeof vi.fn>).mock.calls[0][1] as Thread
    expect(saved.dockState.tabs).toEqual([
      { kind: 'graph' },
      { kind: 'editor', path: '/vault/n.md' }
    ])
    expect(window.api.lifecycle.quitReady).toHaveBeenCalledTimes(1)
  })

  it('skips the dock flush when no thread is active', async () => {
    registerQuitHandler()
    await state.appWillQuitHandler?.()

    expect(window.api.thread.save).not.toHaveBeenCalled()
    expect(window.api.lifecycle.quitReady).toHaveBeenCalledTimes(1)
  })

  it('sends quitReady even when a flush fails', async () => {
    state.flushCanvasPromise = Promise.reject(new Error('disk full'))
    window.api.vault.writeState = vi.fn(() => Promise.reject(new Error('also failed')))

    registerQuitHandler()
    await state.appWillQuitHandler?.()

    expect(window.api.lifecycle.quitReady).toHaveBeenCalledTimes(1)
  })
})

describe('gatherVaultState reads ui-store directly', () => {
  beforeEach(() => {
    installApi()
    useThreadStore.setState(useThreadStore.getInitialState())
    useUiStore.setState(useUiStore.getInitialState())
    useVaultStore.setState({
      vaultPath: '/vault',
      state: {
        version: 3,
        lastOpenNote: null,
        fileTreeCollapseState: { '/stale': true }
      }
    })
    useEditorStore.setState({
      activeNotePath: '/vault/notes/hello.md',
      mode: 'rich',
      isDirty: false,
      content: '',
      openTabs: [],
      historyStack: [],
      historyIndex: -1
    })
  })

  it('persists fileTreeCollapseState and ui fields from the ui-store, not the stale snapshot', () => {
    useUiStore.setState({
      backlinkCollapsed: { '/vault/notes/hello.md': false },
      dismissedGhosts: ['g1'],
      outlineVisible: true,
      bookmarkedPaths: ['/vault/notes/pin.md'],
      graphTutorialDismissed: true,
      fileTreeCollapseState: { '/vault/docs': true }
    })

    flushVaultState()

    const writeState = window.api.vault.writeState as ReturnType<typeof vi.fn>
    expect(writeState).toHaveBeenCalledTimes(1)
    expect(writeState.mock.calls[0][1]).toEqual({
      version: 3,
      lastOpenNote: '/vault/notes/hello.md',
      fileTreeCollapseState: { '/vault/docs': true },
      ui: {
        backlinkCollapsed: { '/vault/notes/hello.md': false },
        dismissedGhosts: ['g1'],
        outlineVisible: true,
        bookmarkedPaths: ['/vault/notes/pin.md'],
        graphTutorialDismissed: true
      }
    })
  })
})

describe('subscribeVaultPersist on ui-store changes', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    installApi()
    useThreadStore.setState(useThreadStore.getInitialState())
    useUiStore.setState(useUiStore.getInitialState())
    useVaultStore.setState({
      vaultPath: '/vault',
      state: { version: 1, lastOpenNote: null, fileTreeCollapseState: {} }
    })
    useEditorStore.setState({
      activeNotePath: null,
      mode: 'rich',
      isDirty: false,
      content: '',
      openTabs: [],
      historyStack: [],
      historyIndex: -1
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('schedules a debounced persist when ui-store changes (file tree toggle)', () => {
    const unsub = subscribeVaultPersist()
    const writeState = window.api.vault.writeState as ReturnType<typeof vi.fn>

    useUiStore.getState().toggleFileTreeCollapsed('/vault/docs')
    expect(writeState).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1000)

    expect(writeState).toHaveBeenCalledTimes(1)
    expect(writeState.mock.calls[0][1].fileTreeCollapseState).toEqual({ '/vault/docs': true })

    unsub()
  })
})
