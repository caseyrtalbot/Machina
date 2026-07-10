import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useThreadStore, flushDockState } from '../thread-store'
import { threadRuntimeIsClosed, useAgentDispatchStore } from '../agent-dispatch-store'
import { useTerminalStripStore } from '../terminal-strip-store'
import type { Thread } from '@shared/thread-types'
import { DEFAULT_TERMINAL_STRIP } from '@shared/dock-types'
import { setErrorNotifier } from '../../utils/error-logger'

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
  useAgentDispatchStore.setState(useAgentDispatchStore.getInitialState())
  useTerminalStripStore.setState(useTerminalStripStore.getInitialState())
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
    },
    terminal: { kill: vi.fn().mockResolvedValue(undefined) }
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
    useAgentDispatchStore
      .getState()
      .setHarnessLaunch('/v', 'test-fixer', { status: 'indeterminate', threadId: 'a' })
    await useThreadStore.getState().finalizeAssistantMessage('a')
    const msgs = useThreadStore.getState().threadsById['a'].messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe('assistant')
    if (msgs[0].role !== 'assistant') return
    expect(msgs[0].body).toBe('Hello')
    expect(useThreadStore.getState().streamingByThreadId['a']).toBeUndefined()
    expect(
      useAgentDispatchStore.getState().harnessLaunchByWorkspace['/v']?.['test-fixer']
    ).toBeUndefined()
  })

  it('addDockTab and removeDockTab mutate the active thread tab list', () => {
    useThreadStore.setState({ activeThreadId: 'a', dockTabsByThreadId: { a: [] } })
    useThreadStore.getState().addDockTab({ kind: 'graph' })
    expect(useThreadStore.getState().dockTabsByThreadId['a']).toEqual([{ kind: 'graph' }])
    useThreadStore.getState().removeDockTab(0)
    expect(useThreadStore.getState().dockTabsByThreadId['a']).toEqual([])
  })

  it('cancelActive requests native abort and waits for main settlement before unlocking', async () => {
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
    expect(useThreadStore.getState().inFlightByThreadId['a']).toBe(true)
  })

  it('cancelActive requests CLI interrupt and waits for main settlement before unlocking', async () => {
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
    expect(useThreadStore.getState().inFlightByThreadId['a']).toBe(true)
  })

  it('surfaces a rejected Stop request without rejecting or unlocking the turn', async () => {
    const notify = vi.fn()
    setErrorNotifier(notify)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).api.agentNative = {
        abort: vi.fn().mockRejectedValue(new Error('abort IPC unavailable'))
      }
      useThreadStore.setState({
        threadsById: { a: sampleThread('a') },
        runIdByThreadId: { a: 'r-fail' },
        inFlightByThreadId: { a: true }
      })

      await expect(useThreadStore.getState().cancelActive('a')).resolves.toBeUndefined()
      expect(useThreadStore.getState().inFlightByThreadId['a']).toBe(true)
      expect(useAgentDispatchStore.getState().cancelRequestedByThreadId['a']).toBe(true)
      expect(notify).toHaveBeenCalledWith(expect.stringMatching(/stop request failed/i))
    } finally {
      setErrorNotifier(() => {})
    }
  })

  it('does not unlock a timed-out native turn when Stop has no runId and run resolves late', async () => {
    vi.useFakeTimers()
    try {
      let resolveRun: ((value: { runId: string }) => void) | undefined
      const abort = vi.fn().mockResolvedValue(undefined)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).api.agentNative = {
        run: vi.fn(
          () =>
            new Promise<{ runId: string }>((resolve) => {
              resolveRun = resolve
            })
        ),
        abort
      }
      useThreadStore.setState({
        vaultPath: '/v',
        activeThreadId: 'a',
        threadsById: { a: sampleThread('a') }
      })

      const pending = useThreadStore.getState().appendUserMessage('hello')
      await vi.advanceTimersByTimeAsync(15_000)
      await expect(pending).resolves.toBe('indeterminate')
      await useThreadStore.getState().cancelActive('a')
      expect(abort).not.toHaveBeenCalled()
      expect(useThreadStore.getState().inFlightByThreadId['a']).toBe(true)

      resolveRun?.({ runId: 'late-run' })
      await vi.waitFor(() => expect(abort).toHaveBeenCalledWith('late-run'))
      expect(useThreadStore.getState().inFlightByThreadId['a']).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('replays Stop even while persistence of the timeout status is stalled', async () => {
    vi.useFakeTimers()
    try {
      let resolveRun: ((value: { runId: string }) => void) | undefined
      const abort = vi.fn().mockResolvedValue(undefined)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).api.agentNative = {
        run: vi.fn(
          () =>
            new Promise<{ runId: string }>((resolve) => {
              resolveRun = resolve
            })
        ),
        abort
      }
      // First save persists the user turn. The diagnostic save after the run
      // timeout never settles.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).api.thread.save = vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockReturnValueOnce(new Promise(() => {}))
      useThreadStore.setState({
        vaultPath: '/v',
        activeThreadId: 'a',
        threadsById: { a: sampleThread('a') }
      })

      const pending = useThreadStore.getState().appendUserMessage('hello')
      await vi.advanceTimersByTimeAsync(15_000)
      await useThreadStore.getState().cancelActive('a')
      resolveRun?.({ runId: 'late-during-save' })
      await vi.waitFor(() => expect(abort).toHaveBeenCalledWith('late-during-save'))

      await vi.advanceTimersByTimeAsync(15_000)
      await expect(pending).resolves.toBe('indeterminate')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not unlock a timed-out CLI turn after Stop and a late accepted input', async () => {
    vi.useFakeTimers()
    try {
      let resolveInput: ((value: { ok: true }) => void) | undefined
      const cancel = vi.fn().mockResolvedValue({ ok: true })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).api.cliThread = {
        input: vi.fn(
          () =>
            new Promise<{ ok: true }>((resolve) => {
              resolveInput = resolve
            })
        ),
        cancel
      }
      useThreadStore.setState({
        vaultPath: '/v',
        activeThreadId: 'a',
        threadsById: { a: { ...sampleThread('a'), agent: 'cli-claude' as const } }
      })

      const pending = useThreadStore.getState().appendUserMessage('hello')
      await vi.advanceTimersByTimeAsync(15_000)
      await expect(pending).resolves.toBe('indeterminate')
      await useThreadStore.getState().cancelActive('a')
      expect(cancel).toHaveBeenCalledWith('a')
      expect(useThreadStore.getState().inFlightByThreadId['a']).toBe(true)

      resolveInput?.({ ok: true })
      await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(2))
      expect(useThreadStore.getState().inFlightByThreadId['a']).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('preserves Stop through deletion and aborts a native run that accepts late', async () => {
    vi.useFakeTimers()
    try {
      let resolveRun: ((value: { runId: string }) => void) | undefined
      const abort = vi.fn().mockResolvedValue(undefined)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).api.agentNative = {
        run: vi.fn(
          () =>
            new Promise<{ runId: string }>((resolve) => {
              resolveRun = resolve
            })
        ),
        abort
      }
      useThreadStore.setState({
        vaultPath: '/v',
        activeThreadId: 'a',
        threadsById: { a: sampleThread('a') }
      })

      const pending = useThreadStore.getState().appendUserMessage('hello')
      await vi.advanceTimersByTimeAsync(15_000)
      await expect(pending).resolves.toBe('indeterminate')
      await useThreadStore.getState().cancelActive('a')
      await useThreadStore.getState().deleteThread('a')
      expect(useThreadStore.getState().threadsById['a']).toBeUndefined()

      resolveRun?.({ runId: 'late-after-delete' })
      await vi.waitFor(() => expect(abort).toHaveBeenCalledWith('late-after-delete'))
      expect(useThreadStore.getState().runIdByThreadId['a']).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
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

  it('keeps a timed-out native run indeterminate because it may resolve late', async () => {
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
      await expect(p).resolves.toBe('indeterminate')

      expect(useThreadStore.getState().inFlightByThreadId['a']).toBe(true)
      const msgs = useThreadStore.getState().threadsById['a'].messages
      const sys = msgs.find((m) => m.role === 'system')
      expect(sys).toBeDefined()
      expect(sys?.body).toMatch(/status is unknown.*may still execute.*do not retry/i)
      expect(sys?.body).toMatch(/Stop cannot confirm cancellation.*wait for the thread to settle/i)
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

  it('setThreadModel updates and persists for native AND CLI threads (workstation step 1)', async () => {
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
    // CLI threads persist the pick too (was a no-op before workstation step 1).
    await useThreadStore.getState().setThreadModel('b', 'sonnet')
    expect(useThreadStore.getState().threadsById['b'].model).toBe('sonnet')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).api.thread.save).toHaveBeenCalledTimes(2)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).api.thread.save).toHaveBeenLastCalledWith(
      '/v',
      expect.objectContaining({ id: 'b', model: 'sonnet' })
    )
  })

  it('setThreadModel with an unchanged model does not persist', async () => {
    useThreadStore.setState({
      vaultPath: '/v',
      threadsById: { b: { ...sampleThread('b'), agent: 'cli-claude' as const } }
    })
    await useThreadStore.getState().setThreadModel('b', 'claude-sonnet-4-6')
    expect(useThreadStore.getState().threadsById['b'].model).toBe('claude-sonnet-4-6')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).api.thread.save).not.toHaveBeenCalled()
  })

  it('setThreadAgentId attaches the slug and persists (workstation step 3)', async () => {
    useThreadStore.setState({
      vaultPath: '/v',
      threadsById: { b: { ...sampleThread('b'), agent: 'cli-claude' as const } }
    })
    await useThreadStore.getState().setThreadAgentId('b', 'test-fixer')
    expect(useThreadStore.getState().threadsById['b'].agentId).toBe('test-fixer')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).api.thread.save).toHaveBeenCalledWith(
      '/v',
      expect.objectContaining({ id: 'b', agentId: 'test-fixer' })
    )
  })

  it('setThreadAgentId with an unchanged agentId does not persist', async () => {
    useThreadStore.setState({
      vaultPath: '/v',
      threadsById: {
        b: { ...sampleThread('b'), agent: 'cli-claude' as const, agentId: 'test-fixer' }
      }
    })
    await useThreadStore.getState().setThreadAgentId('b', 'test-fixer')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).api.thread.save).not.toHaveBeenCalled()
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
    const accepted = await useThreadStore.getState().appendUserMessage('hello')
    expect(accepted).toBe('refused')
    expect(useThreadStore.getState().inFlightByThreadId['a']).toBeUndefined()
    const msgs = useThreadStore.getState().threadsById['a'].messages
    const sys = msgs.find((m) => m.role === 'system')
    expect(sys?.body).toContain('not delivered')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).api.thread.save).toHaveBeenCalled()
  })

  it('keeps a timed-out CLI input indeterminate and blocks a duplicate turn', async () => {
    vi.useFakeTimers()
    try {
      let resolveInput: ((value: { ok: true }) => void) | undefined
      const input = vi.fn(
        () =>
          new Promise<{ ok: true }>((resolve) => {
            resolveInput = resolve
          })
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).api.cliThread = { input }
      useThreadStore.setState({
        vaultPath: '/v',
        activeThreadId: 'a',
        threadsById: { a: { ...sampleThread('a'), agent: 'cli-claude' as const } }
      })

      const pending = useThreadStore.getState().appendUserMessage('hello')
      await vi.advanceTimersByTimeAsync(15_000)
      await expect(pending).resolves.toBe('indeterminate')
      expect(useThreadStore.getState().inFlightByThreadId['a']).toBe(true)
      const sys = useThreadStore
        .getState()
        .threadsById['a'].messages.find((message) => message.role === 'system')
      expect(sys?.body).toMatch(/may still execute.*do not retry/i)

      resolveInput?.({ ok: true })
      await Promise.resolve()
      expect(input).toHaveBeenCalledOnce()
      expect(useThreadStore.getState().inFlightByThreadId['a']).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds user-message persistence without dispatching an unpersisted turn', async () => {
    vi.useFakeTimers()
    try {
      const input = vi.fn()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).api.thread.save = vi.fn(() => new Promise(() => {}))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).api.cliThread = { input }
      useThreadStore.setState({
        vaultPath: '/v',
        activeThreadId: 'a',
        threadsById: { a: { ...sampleThread('a'), agent: 'cli-claude' as const } }
      })

      const pending = useThreadStore.getState().appendUserMessage('hello')
      await vi.advanceTimersByTimeAsync(15_000)
      await expect(pending).resolves.toBe('indeterminate')
      expect(input).not.toHaveBeenCalled()
      expect(useThreadStore.getState().inFlightByThreadId['a']).toBe(true)
      expect(
        useThreadStore
          .getState()
          .threadsById['a'].messages.find((message) => message.role === 'system')?.body
      ).toMatch(/persistence status is unknown.*not dispatched.*do not retry/i)
    } finally {
      vi.useRealTimers()
    }
  })

  it('dispatches the same turn once when timed-out user-message persistence succeeds late', async () => {
    vi.useFakeTimers()
    try {
      let resolveSave: (() => void) | undefined
      const input = vi.fn().mockResolvedValue({ ok: true })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).api.thread.save = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveSave = resolve
          })
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).api.cliThread = { input }
      useThreadStore.setState({
        vaultPath: '/v',
        activeThreadId: 'a',
        threadsById: { a: { ...sampleThread('a'), agent: 'cli-claude' as const } }
      })

      const pending = useThreadStore.getState().appendUserMessage('hello')
      await vi.advanceTimersByTimeAsync(15_000)
      await expect(pending).resolves.toBe('indeterminate')
      expect(input).not.toHaveBeenCalled()

      resolveSave?.()
      await vi.waitFor(() => expect(input).toHaveBeenCalledOnce())
      expect(input).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'a', text: 'hello' }))
      expect(useThreadStore.getState().inFlightByThreadId['a']).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('unlocks without dispatch when timed-out user-message persistence fails late', async () => {
    vi.useFakeTimers()
    try {
      let rejectSave: ((error: Error) => void) | undefined
      const input = vi.fn()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).api.thread.save = vi.fn(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectSave = reject
          })
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).api.cliThread = { input }
      useThreadStore.setState({
        vaultPath: '/v',
        activeThreadId: 'a',
        threadsById: { a: { ...sampleThread('a'), agent: 'cli-claude' as const } }
      })

      const pending = useThreadStore.getState().appendUserMessage('hello')
      await vi.advanceTimersByTimeAsync(15_000)
      await expect(pending).resolves.toBe('indeterminate')
      expect(useThreadStore.getState().inFlightByThreadId['a']).toBe(true)

      rejectSave?.(new Error('late disk failure'))
      await vi.waitFor(() =>
        expect(useThreadStore.getState().inFlightByThreadId['a']).toBeUndefined()
      )
      expect(input).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a failed send into a cli-raw thread explains raw semantics, not a missing CLI', async () => {
    // The spawner refuses raw sends by design (no invocation template until
    // step 8) — the system message must not claim the CLI is uninstalled.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).api.cliThread = { input: vi.fn().mockResolvedValue({ ok: false }) }
    const rawThread = { ...sampleThread('a'), agent: 'cli-raw' as const }
    useThreadStore.setState({
      vaultPath: '/v',
      activeThreadId: 'a',
      threadsById: { a: rawThread }
    })
    const accepted = await useThreadStore.getState().appendUserMessage('hello')
    expect(accepted).toBe('refused')
    expect(useThreadStore.getState().inFlightByThreadId['a']).toBeUndefined()
    const sys = useThreadStore.getState().threadsById['a'].messages.find((m) => m.role === 'system')
    expect(sys?.body).toContain('Interact via the terminal')
    expect(sys?.body).not.toContain('installed')
  })

  it('a refused bound raw invocation points to harness configuration, not terminal-only semantics', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).api.cliThread = { input: vi.fn().mockResolvedValue({ ok: false }) }
    const rawThread = {
      ...sampleThread('a'),
      agent: 'cli-raw' as const,
      agentId: 'local-raw-tool'
    }
    useThreadStore.setState({
      vaultPath: '/v',
      activeThreadId: 'a',
      threadsById: { a: rawThread }
    })
    const accepted = await useThreadStore.getState().appendUserMessage('hello')
    expect(accepted).toBe('refused')
    const sys = useThreadStore.getState().threadsById['a'].messages.find((m) => m.role === 'system')
    expect(sys?.body).toContain('bound raw harness invocation was refused')
    expect(sys?.body).toContain('invocation template')
    expect(sys?.body).not.toContain('installed')
  })

  it('forwards the persisted agentId on cli-thread input (workstation step 6)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).api.cliThread = { input: vi.fn().mockResolvedValue({ ok: true }) }
    const harnessThread = {
      ...sampleThread('a'),
      agent: 'cli-claude' as const,
      agentId: 'test-fixer'
    }
    useThreadStore.setState({
      vaultPath: '/v',
      activeThreadId: 'a',
      threadsById: { a: harnessThread }
    })
    await useThreadStore.getState().appendUserMessage('run')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).api.cliThread.input).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'a', agentId: 'test-fixer' })
    )
  })

  it('forwards the thread model on cli-thread input (workstation step 1)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).api.cliThread = { input: vi.fn().mockResolvedValue({ ok: true }) }
    const cliThread = { ...sampleThread('a'), agent: 'cli-claude' as const, model: 'sonnet' }
    useThreadStore.setState({
      vaultPath: '/v',
      activeThreadId: 'a',
      threadsById: { a: cliThread }
    })
    await useThreadStore.getState().appendUserMessage('run')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).api.cliThread.input).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'a', model: 'sonnet' })
    )
  })

  it('createThread overlays and persists the agentId, and spawn carries it', async () => {
    const created = { ...sampleThread('h1'), agent: 'cli-claude' as const }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).api.thread.create = vi.fn().mockResolvedValue(created)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).api.cliThread = {
      spawn: vi.fn().mockResolvedValue({ ok: true, sessionId: 's1' })
    }
    useThreadStore.setState({ vaultPath: '/v' })
    const t = await useThreadStore
      .getState()
      .createThread('cli-claude', 'claude-sonnet-4-6', 'test-fixer', 'test-fixer')
    expect(t.agentId).toBe('test-fixer')
    expect(useThreadStore.getState().threadsById['h1'].agentId).toBe('test-fixer')
    // Persisted (thread.save) so attribution survives relaunch.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).api.thread.save).toHaveBeenCalledWith(
      '/v',
      expect.objectContaining({ id: 'h1', agentId: 'test-fixer' })
    )
    // Spawn also carries the thread model (workstation step 1) — the filler
    // here resolves to "adapter default" at the IPC boundary.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).api.cliThread.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'h1', agentId: 'test-fixer', model: 'claude-sonnet-4-6' })
    )
  })

  it('does not insert a thread from workspace A after switching to workspace B', async () => {
    let resolveCreate: ((value: Thread) => void) | undefined
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).api.thread.create = vi.fn(
      () =>
        new Promise<Thread>((resolve) => {
          resolveCreate = resolve
        })
    )
    useThreadStore.getState().setVaultPath('/workspace-a')

    const pending = useThreadStore
      .getState()
      .createThread('machina-native', 'claude-sonnet-4-6', 'from A')
    useThreadStore.getState().setVaultPath('/workspace-b')
    resolveCreate?.(sampleThread('from-a'))

    await expect(pending).rejects.toThrow(/workspace changed/i)
    expect(useThreadStore.getState().vaultPath).toBe('/workspace-b')
    expect(useThreadStore.getState().threadsById['from-a']).toBeUndefined()
  })

  it('workspace switch fences old thread dispatch without auto-closing PTYs', () => {
    const close = vi.fn().mockResolvedValue(undefined)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).api.cliThread = { close }
    const oldThread = { ...sampleThread('old-cli'), agent: 'cli-claude' as const }
    useThreadStore.setState({
      vaultPath: '/workspace-a',
      activeThreadId: 'old-cli',
      threadsById: { 'old-cli': oldThread }
    })
    useTerminalStripStore.setState({
      byThreadId: {
        'old-cli': {
          ...DEFAULT_TERMINAL_STRIP,
          sessions: [{ tabId: 'tab-1', sessionId: 'pty-old', cwd: '/workspace-a' }],
          activeTabId: 'tab-1'
        }
      }
    })

    useThreadStore.getState().setVaultPath('/workspace-b')

    expect(close).not.toHaveBeenCalled()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).api.terminal.kill).not.toHaveBeenCalled()
    expect(threadRuntimeIsClosed('old-cli')).toBe(true)
    expect(useThreadStore.getState().threadsById).toEqual({})
    expect(useThreadStore.getState().vaultPath).toBe('/workspace-b')
  })

  it('loadThreads reopens persisted thread ids after a workspace-switch fence', async () => {
    const restored = { ...sampleThread('old-cli'), agent: 'cli-claude' as const }
    useAgentDispatchStore.getState().dropThreadRuntime('old-cli')
    expect(threadRuntimeIsClosed('old-cli')).toBe(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).api.thread.list = vi.fn().mockResolvedValue([restored])
    useThreadStore.setState({ vaultPath: '/workspace-a' })

    await useThreadStore.getState().loadThreads()

    expect(threadRuntimeIsClosed('old-cli')).toBe(false)
    expect(useThreadStore.getState().threadsById['old-cli']).toEqual(restored)
  })

  it('does not dispatch input while the new CLI thread spawn is still pending', async () => {
    const created = { ...sampleThread('h1'), agent: 'cli-claude' as const }
    let resolveSpawn:
      | ((value: { ok: true; sessionId: string } | { ok: false; error: string }) => void)
      | undefined
    const input = vi.fn()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).api.thread.create = vi.fn().mockResolvedValue(created)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).api.cliThread = {
      spawn: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveSpawn = resolve
          })
      ),
      input
    }
    useThreadStore.setState({ vaultPath: '/v' })

    const creating = useThreadStore
      .getState()
      .createThread('cli-claude', 'claude-sonnet-4-6', 'pending')
    await vi.waitFor(() => expect(useThreadStore.getState().activeThreadId).toBe('h1'))
    expect(useAgentDispatchStore.getState().threadStartById['h1']).toBe('starting')
    await expect(useThreadStore.getState().appendUserMessage('too early')).resolves.toBe(
      'indeterminate'
    )
    expect(input).not.toHaveBeenCalled()
    expect(useThreadStore.getState().threadsById['h1'].messages).toEqual([])

    resolveSpawn?.({ ok: true, sessionId: 's1' })
    await creating
    expect(useAgentDispatchStore.getState().threadStartById['h1']).toBe('ready')
  })

  it('keeps a timed-out spawn blocked until its late settlement', async () => {
    vi.useFakeTimers()
    try {
      const created = { ...sampleThread('h1'), agent: 'cli-claude' as const }
      let resolveSpawn:
          | ((value: { ok: true; sessionId: string } | { ok: false; error: string }) => void)
          | undefined
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).api.thread.create = vi.fn().mockResolvedValue(created)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).api.cliThread = {
        spawn: vi.fn(
          () =>
            new Promise((resolve) => {
              resolveSpawn = resolve
            })
        ),
        input: vi.fn()
      }
      useThreadStore.setState({ vaultPath: '/v' })

      const creating = useThreadStore
        .getState()
        .createThread('cli-claude', 'claude-sonnet-4-6', 'pending')
      await vi.advanceTimersByTimeAsync(15_000)
      await creating
      expect(useAgentDispatchStore.getState().threadStartById['h1']).toBe('indeterminate')

      resolveSpawn?.({ ok: true, sessionId: 's-late' })
      await vi.waitFor(() =>
        expect(useAgentDispatchStore.getState().threadStartById['h1']).toBe('ready')
      )
    } finally {
      vi.useRealTimers()
    }
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
    const accepted = await useThreadStore.getState().appendUserMessage('hello')
    expect(accepted).toBe('accepted')
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
