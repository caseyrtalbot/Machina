import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useThreadStore, flushDockState } from '../thread-store'
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
    useThreadStore.setState({ activeThreadId: 'a', runIdByThreadId: { a: 'r-1' } })
    useThreadStore.getState().appendAssistantStreamChunk('a', 'r-1', 'Hel')
    useThreadStore.getState().appendAssistantStreamChunk('a', 'r-1', 'lo')
    expect(useThreadStore.getState().streamingByThreadId['a']).toBe('Hello')
  })

  it('appendAssistantStreamChunk drops chunks whose runId does not match the active run', () => {
    useThreadStore.setState({ activeThreadId: 'a', runIdByThreadId: { a: 'r-2' } })
    useThreadStore.getState().appendAssistantStreamChunk('a', 'r-2', 'keep')
    // Stale chunk from an aborted/superseded run must not bleed into the buffer.
    useThreadStore.getState().appendAssistantStreamChunk('a', 'r-1', 'stale')
    // No active run at all (already finalized) → also dropped.
    useThreadStore.setState({ runIdByThreadId: {} })
    useThreadStore.getState().appendAssistantStreamChunk('a', 'r-2', 'late')
    expect(useThreadStore.getState().streamingByThreadId['a']).toBe('keep')
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

  it('clears in-flight and appends a system message when agentNative.run never returns a runId', async () => {
    vi.useFakeTimers()
    try {
      // run() returns a promise that never resolves — simulates the main process
      // accepting the IPC but never producing a runId (the wedge condition).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).api.agentNative = { run: vi.fn(() => new Promise(() => {})) }
      useThreadStore.setState({
        vaultPath: '/v',
        activeThreadId: 'a',
        threadsById: { a: sampleThread('a') }
      })
      const p = useThreadStore.getState().appendUserMessage('hello')
      // Advance past the 15s start-timeout, flushing microtasks along the way.
      await vi.advanceTimersByTimeAsync(15_000)
      await p

      expect(useThreadStore.getState().inFlightByThreadId['a']).toBeUndefined()
      const msgs = useThreadStore.getState().threadsById['a'].messages
      const sys = msgs.find((m) => m.role === 'system')
      expect(sys).toBeDefined()
      expect(sys?.body).toContain('failed to start')
    } finally {
      vi.useRealTimers()
    }
  })

  it('filters empty/whitespace-body messages out of the native history', async () => {
    const run = vi.fn().mockResolvedValue({ runId: 'r-9' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).api.agentNative = { run }
    const t: Thread = {
      ...sampleThread('a'),
      messages: [
        { role: 'user', body: 'first question', sentAt: '2026-05-01T13:00:00Z' },
        // Tool-only turn persisted with an empty body — must not reach the API.
        { role: 'assistant', body: '', sentAt: '2026-05-01T13:00:01Z' },
        { role: 'assistant', body: '   \n', sentAt: '2026-05-01T13:00:02Z' },
        { role: 'assistant', body: 'real answer', sentAt: '2026-05-01T13:00:03Z' },
        { role: 'system', body: 'noise', sentAt: '2026-05-01T13:00:04Z' }
      ]
    }
    useThreadStore.setState({ vaultPath: '/v', activeThreadId: 'a', threadsById: { a: t } })
    await useThreadStore.getState().appendUserMessage('next question')
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][0].userMessage).toBe('next question')
    expect(run.mock.calls[0][0].historyMessages).toEqual([
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'real answer' }
    ])
  })

  it('represents tool-only assistant turns in native history as a textual tool summary', async () => {
    const run = vi.fn().mockResolvedValue({ runId: 'r-10' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).api.agentNative = { run }
    const t: Thread = {
      ...sampleThread('a'),
      messages: [
        { role: 'user', body: 'read my note', sentAt: '2026-05-01T13:00:00Z' },
        {
          role: 'assistant',
          body: '',
          sentAt: '2026-05-01T13:00:01Z',
          toolCalls: [
            {
              call: { id: 't1', kind: 'read_note', args: { path: 'a.md' } },
              result: { id: 't1', ok: true, output: { content: 'note body' } }
            }
          ]
        },
        { role: 'assistant', body: 'done reading', sentAt: '2026-05-01T13:00:02Z' }
      ]
    }
    useThreadStore.setState({ vaultPath: '/v', activeThreadId: 'a', threadsById: { a: t } })
    await useThreadStore.getState().appendUserMessage('and now?')
    const history = run.mock.calls[0][0].historyMessages as Array<{
      role: string
      content: string
    }>
    expect(history).toHaveLength(3)
    expect(history[1].role).toBe('assistant')
    expect(history[1].content).toContain('[tool read_note')
    expect(history[1].content).toContain('a.md')
    expect(history[1].content).toContain('note body')
    expect(history[2]).toEqual({ role: 'assistant', content: 'done reading' })
  })

  it('setThreadModel updates a native thread and persists; CLI threads are ignored', async () => {
    useThreadStore.setState({
      vaultPath: '/v',
      threadsById: {
        a: sampleThread('a'),
        b: { ...sampleThread('b'), agent: 'cli-claude' as const }
      }
    })
    await useThreadStore.getState().setThreadModel('a', 'claude-opus-4-8')
    expect(useThreadStore.getState().threadsById['a'].model).toBe('claude-opus-4-8')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).api.thread.save).toHaveBeenCalledTimes(1)
    await useThreadStore.getState().setThreadModel('b', 'claude-opus-4-8')
    expect(useThreadStore.getState().threadsById['b'].model).toBe('claude-sonnet-4-6')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).api.thread.save).toHaveBeenCalledTimes(1)
  })

  it('clears in-flight and appends a system message when CLI input delivery fails', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).api.cliThread = { input: vi.fn().mockResolvedValue({ ok: false }) }
    const cliThread = { ...sampleThread('a'), agent: 'cli-claude' as const }
    useThreadStore.setState({
      vaultPath: '/v',
      activeThreadId: 'a',
      threadsById: { a: cliThread }
    })
    await useThreadStore.getState().appendUserMessage('hello')
    expect(useThreadStore.getState().inFlightByThreadId['a']).toBeUndefined()
    const msgs = useThreadStore.getState().threadsById['a'].messages
    const sys = msgs.find((m) => m.role === 'system')
    expect(sys?.body).toContain('not delivered')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).api.thread.save).toHaveBeenCalled()
  })

  it('keeps in-flight set when CLI input delivery succeeds', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).api.cliThread = { input: vi.fn().mockResolvedValue({ ok: true }) }
    const cliThread = { ...sampleThread('a'), agent: 'cli-claude' as const }
    useThreadStore.setState({
      vaultPath: '/v',
      activeThreadId: 'a',
      threadsById: { a: cliThread }
    })
    await useThreadStore.getState().appendUserMessage('hello')
    expect(useThreadStore.getState().inFlightByThreadId['a']).toBe(true)
    expect(
      useThreadStore.getState().threadsById['a'].messages.some((m) => m.role === 'system')
    ).toBe(false)
  })

  it('archiveThread moves the thread out of threadsById and into archivedThreads', async () => {
    useThreadStore.setState({
      vaultPath: '/v',
      activeThreadId: 'a',
      threadsById: { a: sampleThread('a') }
    })
    await useThreadStore.getState().archiveThread('a')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).api.thread.archive).toHaveBeenCalledWith('/v', 'a')
    expect(useThreadStore.getState().threadsById['a']).toBeUndefined()
    expect(useThreadStore.getState().archivedThreads.map((t) => t.id)).toEqual(['a'])
    expect(useThreadStore.getState().activeThreadId).toBeNull()
  })

  it('loadArchivedThreads populates archivedThreads from the IPC list', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).api.thread.listArchived = vi
      .fn()
      .mockResolvedValue([sampleThread('x'), sampleThread('y')])
    useThreadStore.setState({ vaultPath: '/v' })
    await useThreadStore.getState().loadArchivedThreads()
    expect(useThreadStore.getState().archivedThreads.map((t) => t.id)).toEqual(['x', 'y'])
  })

  it('unarchiveThread restores the thread and removes it from archivedThreads', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).api.thread.list = vi.fn().mockResolvedValue([sampleThread('a')])
    useThreadStore.setState({
      vaultPath: '/v',
      archivedThreads: [sampleThread('a'), sampleThread('b')]
    })
    await useThreadStore.getState().unarchiveThread('a')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).api.thread.unarchive).toHaveBeenCalledWith('/v', 'a')
    expect(useThreadStore.getState().archivedThreads.map((t) => t.id)).toEqual(['b'])
    expect(useThreadStore.getState().threadsById['a']).toBeDefined()
  })

  it('deleteArchivedThread unarchives first (thread:delete targets live threads) then deletes', async () => {
    const order: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).api.thread.unarchive = vi.fn(async () => {
      order.push('unarchive')
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).api.thread.delete = vi.fn(async () => {
      order.push('delete')
    })
    useThreadStore.setState({ vaultPath: '/v', archivedThreads: [sampleThread('a')] })
    await useThreadStore.getState().deleteArchivedThread('a')
    expect(order).toEqual(['unarchive', 'delete'])
    expect(useThreadStore.getState().archivedThreads).toEqual([])
  })

  it('flushDockState persists the thread with its current dock tabs', async () => {
    useThreadStore.setState({
      vaultPath: '/v',
      threadsById: { a: sampleThread('a') },
      dockTabsByThreadId: { a: [{ kind: 'graph' }] }
    })
    await flushDockState('a')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const save = (window as any).api.thread.save as ReturnType<typeof vi.fn>
    expect(save).toHaveBeenCalledTimes(1)
    expect((save.mock.calls[0][1] as Thread).dockState.tabs).toEqual([{ kind: 'graph' }])
  })

  it('toggleAutoAccept flips the per-thread autoAcceptSession flag in memory only (no disk write)', () => {
    useThreadStore.setState({
      vaultPath: '/v',
      threadsById: { a: sampleThread('a') }
    })
    useThreadStore.getState().toggleAutoAccept('a')
    expect(useThreadStore.getState().threadsById['a'].autoAcceptSession).toBe(true)
    // Session-only flag must NOT persist — it's a one-off bypass that should die on restart.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).api.thread.save).not.toHaveBeenCalled()
    useThreadStore.getState().toggleAutoAccept('a')
    expect(useThreadStore.getState().threadsById['a'].autoAcceptSession).toBe(false)
  })
})
