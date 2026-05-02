import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useThreadStore } from '../thread-store'
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
  useThreadStore.setState(useThreadStore.getInitialState())
  // Minimal IPC stub so persistence-aware actions don't crash.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).api = {
    thread: {
      save: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([]),
      listArchived: vi.fn().mockResolvedValue([]),
      read: vi.fn(),
      create: vi.fn(),
      archive: vi.fn().mockResolvedValue(undefined),
      unarchive: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      readConfig: vi.fn(),
      writeConfig: vi.fn().mockResolvedValue(undefined)
    }
  }
})

describe('thread-store', () => {
  it('selectThread sets the active id', async () => {
    useThreadStore.getState().setVaultPath('/v')
    useThreadStore.setState({ threadsById: { a: sampleThread('a') } })
    await useThreadStore.getState().selectThread('a')
    expect(useThreadStore.getState().activeThreadId).toBe('a')
  })

  it('appendAssistantStreamChunk concatenates into the streaming buffer', () => {
    useThreadStore.setState({ activeThreadId: 'a' })
    useThreadStore.getState().appendAssistantStreamChunk('a', 'Hel')
    useThreadStore.getState().appendAssistantStreamChunk('a', 'lo')
    expect(useThreadStore.getState().streamingByThreadId['a']).toBe('Hello')
  })

  it('finalizeAssistantMessage moves streaming buffer into messages', async () => {
    useThreadStore.setState({
      vaultPath: '/v',
      activeThreadId: 'a',
      threadsById: { a: sampleThread('a') },
      streamingByThreadId: { a: 'Hello' }
    })
    await useThreadStore.getState().finalizeAssistantMessage('a')
    const msgs = useThreadStore.getState().threadsById['a'].messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe('assistant')
    if (msgs[0].role !== 'assistant') return
    expect(msgs[0].body).toBe('Hello')
    expect(useThreadStore.getState().streamingByThreadId['a']).toBeUndefined()
  })

  it('addDockTab and removeDockTab mutate the active thread tab list', () => {
    useThreadStore.setState({ activeThreadId: 'a', dockTabsByThreadId: { a: [] } })
    useThreadStore.getState().addDockTab({ kind: 'graph' })
    expect(useThreadStore.getState().dockTabsByThreadId['a']).toEqual([{ kind: 'graph' }])
    useThreadStore.getState().removeDockTab(0)
    expect(useThreadStore.getState().dockTabsByThreadId['a']).toEqual([])
  })

  it('cancelActive on a machina-native thread calls agentNative.abort with the runId', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).api.agentNative = { abort: vi.fn().mockResolvedValue(undefined) }
    useThreadStore.setState({
      threadsById: { a: sampleThread('a') },
      runIdByThreadId: { a: 'r-7' },
      inFlightByThreadId: { a: true }
    })
    await useThreadStore.getState().cancelActive('a')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).api.agentNative.abort).toHaveBeenCalledWith('r-7')
    expect(useThreadStore.getState().inFlightByThreadId['a']).toBeUndefined()
  })

  it('cancelActive on a CLI thread calls cliThread.cancel with the threadId', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).api.cliThread = { cancel: vi.fn().mockResolvedValue({ ok: true }) }
    const cliThread = { ...sampleThread('a'), agent: 'cli-claude' as const }
    useThreadStore.setState({
      threadsById: { a: cliThread },
      inFlightByThreadId: { a: true }
    })
    await useThreadStore.getState().cancelActive('a')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).api.cliThread.cancel).toHaveBeenCalledWith('a')
    expect(useThreadStore.getState().inFlightByThreadId['a']).toBeUndefined()
  })

  it('renameThread updates the title and persists', async () => {
    useThreadStore.setState({
      vaultPath: '/v',
      threadsById: { a: sampleThread('a') }
    })
    await useThreadStore.getState().renameThread('a', '  New title  ')
    expect(useThreadStore.getState().threadsById['a'].title).toBe('New title')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).api.thread.save).toHaveBeenCalled()
  })

  it('renameThread ignores empty/whitespace input', async () => {
    useThreadStore.setState({
      vaultPath: '/v',
      threadsById: { a: sampleThread('a') }
    })
    await useThreadStore.getState().renameThread('a', '   ')
    expect(useThreadStore.getState().threadsById['a'].title).toBe('Sample')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).api.thread.save).not.toHaveBeenCalled()
  })

  it('toggleAutoAccept flips the per-thread autoAcceptSession flag and persists', async () => {
    useThreadStore.setState({
      vaultPath: '/v',
      threadsById: { a: sampleThread('a') }
    })
    await useThreadStore.getState().toggleAutoAccept('a')
    expect(useThreadStore.getState().threadsById['a'].autoAcceptSession).toBe(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).api.thread.save).toHaveBeenCalled()
    await useThreadStore.getState().toggleAutoAccept('a')
    expect(useThreadStore.getState().threadsById['a'].autoAcceptSession).toBe(false)
  })
})
