import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useDockStore, flushDockState, validateThreadTabs } from '../dock-store'
import { useThreadStore } from '../thread-store'
import { useTerminalStripStore } from '../terminal-strip-store'
import { DOCK_TAB_KINDS, type DockTab } from '@shared/dock-types'
import type { Thread } from '@shared/thread-types'

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

beforeEach(() => {
  useDockStore.setState(useDockStore.getInitialState())
  useThreadStore.setState(useThreadStore.getInitialState())
  useTerminalStripStore.setState(useTerminalStripStore.getInitialState(), true)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).api = {
    thread: {
      save: vi.fn().mockResolvedValue(undefined),
      readConfig: vi.fn().mockResolvedValue({}),
      writeConfig: vi.fn().mockResolvedValue(undefined)
    },
    fs: { fileExists: vi.fn().mockResolvedValue(true) }
  }
  useThreadStore.setState({ vaultPath: '/v', activeThreadId: 'a' })
})

describe('dock-tab variant retirement (Phase 3 step 3)', () => {
  it('the DockTab union no longer carries a terminal variant (type-level)', () => {
    // @ts-expect-error — kind:'terminal' is retired; this must not compile.
    const retired: DockTab = { kind: 'terminal', sessionId: 'sess-1' }
    expect(retired).toBeDefined()
    expect(DOCK_TAB_KINDS).toEqual(['canvas', 'editor', 'graph', 'ghosts', 'health'])
    expect(DOCK_TAB_KINDS).not.toContain('terminal')
  })
})

describe('dock-store tab actions (migrated from thread-store, behavior-preserving)', () => {
  it('addDockTab and removeDockTab mutate the active thread tab list', () => {
    useDockStore.setState({ dockTabsByThreadId: { a: [] } })
    useDockStore.getState().addDockTab({ kind: 'graph' })
    expect(useDockStore.getState().dockTabsByThreadId['a']).toEqual([{ kind: 'graph' }])
    useDockStore.getState().removeDockTab(0)
    expect(useDockStore.getState().dockTabsByThreadId['a']).toEqual([])
  })

  it('actions are no-ops without an active thread', () => {
    useThreadStore.setState({ activeThreadId: null })
    useDockStore.getState().addDockTab({ kind: 'graph' })
    useDockStore.getState().openOrFocusDockTab({ kind: 'health' })
    expect(useDockStore.getState().dockTabsByThreadId).toEqual({})
  })

  it('addDockTab expands the dock and activates the new tab', () => {
    useDockStore.setState({ dockCollapsed: true, dockTabsByThreadId: { a: [{ kind: 'graph' }] } })
    useDockStore.getState().addDockTab({ kind: 'health' })
    const s = useDockStore.getState()
    expect(s.dockCollapsed).toBe(false)
    expect(s.dockTabsByThreadId['a']).toEqual([{ kind: 'graph' }, { kind: 'health' }])
    expect(s.dockActiveIndexByThreadId['a']).toBe(1)
  })

  it('openOrFocusDockTab focuses an existing identity instead of duplicating', () => {
    useDockStore.getState().openOrFocusDockTab({ kind: 'editor', path: '/v/a.md' })
    useDockStore.getState().openOrFocusDockTab({ kind: 'graph' })
    useDockStore.getState().openOrFocusDockTab({ kind: 'editor', path: '/v/a.md' })
    const s = useDockStore.getState()
    expect(s.dockTabsByThreadId['a']).toEqual([
      { kind: 'editor', path: '/v/a.md' },
      { kind: 'graph' }
    ])
    expect(s.dockActiveIndexByThreadId['a']).toBe(0)
    // Distinct editor paths and canvas ids are distinct identities.
    useDockStore.getState().openOrFocusDockTab({ kind: 'editor', path: '/v/b.md' })
    expect(useDockStore.getState().dockTabsByThreadId['a']).toHaveLength(3)
  })

  it('removeDockTab shifts the active index left when removing at-or-before it', () => {
    useDockStore.setState({
      dockTabsByThreadId: { a: [{ kind: 'graph' }, { kind: 'ghosts' }, { kind: 'health' }] },
      dockActiveIndexByThreadId: { a: 2 }
    })
    useDockStore.getState().removeDockTab(0)
    const s = useDockStore.getState()
    expect(s.dockTabsByThreadId['a']).toEqual([{ kind: 'ghosts' }, { kind: 'health' }])
    expect(s.dockActiveIndexByThreadId['a']).toBe(1)
    // Out-of-range indices are ignored.
    useDockStore.getState().removeDockTab(9)
    expect(useDockStore.getState().dockTabsByThreadId['a']).toHaveLength(2)
  })

  it('removeDockTabs drops multiple indices and clamps the active index', () => {
    useDockStore.setState({
      dockTabsByThreadId: { a: [{ kind: 'graph' }, { kind: 'ghosts' }, { kind: 'health' }] },
      dockActiveIndexByThreadId: { a: 2 }
    })
    useDockStore.getState().removeDockTabs([0, 2])
    const s = useDockStore.getState()
    expect(s.dockTabsByThreadId['a']).toEqual([{ kind: 'ghosts' }])
    expect(s.dockActiveIndexByThreadId['a']).toBe(0)
  })

  it('reorderDockTab moves a tab in place', () => {
    useDockStore.setState({
      dockTabsByThreadId: { a: [{ kind: 'graph' }, { kind: 'ghosts' }, { kind: 'health' }] }
    })
    useDockStore.getState().reorderDockTab(0, 2)
    expect(useDockStore.getState().dockTabsByThreadId['a']).toEqual([
      { kind: 'ghosts' },
      { kind: 'health' },
      { kind: 'graph' }
    ])
  })

  it('setDockActiveIndex is per-thread and idempotent', () => {
    useDockStore.getState().setDockActiveIndex('a', 3)
    const ref = useDockStore.getState().dockActiveIndexByThreadId
    useDockStore.getState().setDockActiveIndex('a', 3)
    expect(useDockStore.getState().dockActiveIndexByThreadId).toBe(ref)
    expect(useDockStore.getState().dockActiveIndexByThreadId['a']).toBe(3)
  })
})

describe('dock-store layout coupling (dockCollapsed ↔ chatCollapsed)', () => {
  it('collapsing the dock forces the chat pane open and persists layout', () => {
    useThreadStore.setState({ chatCollapsed: true })
    useDockStore.getState().toggleDock()
    expect(useDockStore.getState().dockCollapsed).toBe(true)
    expect(useThreadStore.getState().chatCollapsed).toBe(false)
  })

  it('expanding the dock leaves the chat pane alone', () => {
    useDockStore.setState({ dockCollapsed: true })
    useThreadStore.setState({ chatCollapsed: false })
    useDockStore.getState().toggleDock()
    expect(useDockStore.getState().dockCollapsed).toBe(false)
    expect(useThreadStore.getState().chatCollapsed).toBe(false)
  })

  it('toggleChatCollapsed (thread-store) forces the dock open when collapsing chat', () => {
    useDockStore.setState({ dockCollapsed: true })
    useThreadStore.setState({ chatCollapsed: false })
    useThreadStore.getState().toggleChatCollapsed()
    expect(useThreadStore.getState().chatCollapsed).toBe(true)
    expect(useDockStore.getState().dockCollapsed).toBe(false)
  })

  it('focus mode snapshots and restores dockCollapsed across the store boundary', () => {
    useDockStore.setState({ dockCollapsed: true })
    useThreadStore.getState().toggleFocusMode()
    expect(useDockStore.getState().dockCollapsed).toBe(false)
    useThreadStore.getState().toggleFocusMode()
    expect(useDockStore.getState().dockCollapsed).toBe(true)
  })
})

describe('dock-store thread lifecycle', () => {
  it('seedFromThreads replaces the whole tab map (disk-authoritative reload)', () => {
    useDockStore.setState({ dockTabsByThreadId: { stale: [{ kind: 'graph' }] } })
    const t = {
      ...sampleThread('a'),
      dockState: { tabs: [{ kind: 'health' } satisfies DockTab] }
    }
    useDockStore.getState().seedFromThreads([t])
    expect(useDockStore.getState().dockTabsByThreadId).toEqual({ a: [{ kind: 'health' }] })
  })

  it('seeding drops legacy retired-kind tabs from disk (thread-md decode is transparent)', () => {
    const legacyTabs = [
      { kind: 'terminal', sessionId: 'sess-legacy' },
      { kind: 'graph' }
    ] as unknown as DockTab[]
    const t = { ...sampleThread('a'), dockState: { tabs: legacyTabs } }
    useDockStore.getState().seedFromThreads([t])
    expect(useDockStore.getState().dockTabsByThreadId['a']).toEqual([{ kind: 'graph' }])

    useDockStore.getState().seedThreadTabs('b', legacyTabs)
    expect(useDockStore.getState().dockTabsByThreadId['b']).toEqual([{ kind: 'graph' }])
  })

  it('dropThread forgets tabs and active index', () => {
    useDockStore.setState({
      dockTabsByThreadId: { a: [{ kind: 'graph' }] },
      dockActiveIndexByThreadId: { a: 0 }
    })
    useDockStore.getState().dropThread('a')
    expect(useDockStore.getState().dockTabsByThreadId['a']).toBeUndefined()
    expect(useDockStore.getState().dockActiveIndexByThreadId['a']).toBeUndefined()
  })

  it('setVaultPath (thread-store) resets per-thread dock state but not dockCollapsed', () => {
    useDockStore.setState({
      dockTabsByThreadId: { a: [{ kind: 'graph' }] },
      dockActiveIndexByThreadId: { a: 0 },
      dockCollapsed: true
    })
    useThreadStore.getState().setVaultPath('/other')
    const s = useDockStore.getState()
    expect(s.dockTabsByThreadId).toEqual({})
    expect(s.dockActiveIndexByThreadId).toEqual({})
    expect(s.dockCollapsed).toBe(true)
  })
})

describe('flushDockState (migrated from thread-store)', () => {
  it('persists the thread with its current dock tabs', async () => {
    useThreadStore.setState({ threadsById: { a: sampleThread('a') } })
    useDockStore.setState({ dockTabsByThreadId: { a: [{ kind: 'graph' }] } })
    await flushDockState('a')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const save = (window as any).api.thread.save as ReturnType<typeof vi.fn>
    expect(save).toHaveBeenCalledTimes(1)
    expect((save.mock.calls[0][1] as Thread).dockState.tabs).toEqual([{ kind: 'graph' }])
  })

  it('folds the terminal strip into dockState and skips unknown threads', async () => {
    useThreadStore.setState({ threadsById: { a: sampleThread('a') } })
    useTerminalStripStore.getState().attach('a', { sessionId: 'sess-1', cwd: '/v' })
    await flushDockState('a')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const save = (window as any).api.thread.save as ReturnType<typeof vi.fn>
    const persisted = save.mock.calls[0][1] as Thread
    expect(persisted.dockState.terminalStrip?.sessions[0].sessionId).toBe('sess-1')

    save.mockClear()
    await flushDockState('missing')
    expect(save).not.toHaveBeenCalled()
  })
})

describe('validateThreadTabs', () => {
  it('drops tabs whose backing files are missing, keeps the rest in order', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).api.fs.fileExists = vi.fn(async (p: string) => !p.includes('gone'))
    useDockStore.setState({
      dockTabsByThreadId: {
        a: [
          { kind: 'editor', path: '/v/gone.md' },
          { kind: 'graph' },
          { kind: 'canvas', id: 'default' },
          { kind: 'canvas', id: 'gone-canvas' }
        ]
      }
    })
    await validateThreadTabs('/v', 'a', () => true)
    expect(useDockStore.getState().dockTabsByThreadId['a']).toEqual([
      { kind: 'graph' },
      { kind: 'canvas', id: 'default' }
    ])
  })

  it('writes nothing once the workspace fence reports stale', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).api.fs.fileExists = vi.fn().mockResolvedValue(false)
    const tabs = [{ kind: 'editor', path: '/v/gone.md' } satisfies DockTab]
    useDockStore.setState({ dockTabsByThreadId: { a: tabs } })
    await validateThreadTabs('/v', 'a', () => false)
    expect(useDockStore.getState().dockTabsByThreadId['a']).toBe(tabs)
  })
})
