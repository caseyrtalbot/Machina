/**
 * Renderer half of the workstation step 3 split: the store actions are
 * replaced with mocks and window.api.harness.run returns a canned prompt —
 * composition, validation, and binding are main's (covered by the
 * harness-run / harness-run-registry suites); this suite pins the sequence
 * the renderer owns.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useThreadStore } from '../thread-store'
import { useBlockStore } from '../block-store'
import { useCliSessionStore } from '../cli-session-store'
import { useAgentDispatchStore } from '../agent-dispatch-store'
import { runHarness } from '../harness-run'
import { setErrorNotifier } from '../../utils/error-logger'
import type { HarnessSummary } from '@shared/harness-types'
import type { Block } from '@shared/engine/block-model'
import type { Thread } from '@shared/thread-types'

const summary: HarnessSummary = {
  slug: 'test-fixer',
  name: 'test-fixer',
  description: 'Runs the test suite, fixes the first failure, stops.',
  adapter: 'claude',
  diagnostics: []
}

/** Whatever main composed is what gets sent — the renderer never rebuilds it. */
const MAIN_PROMPT = 'MAIN-COMPOSED HARNESS PROMPT'
const TASK_BRIEF = 'Fix the reported checkout regression.'
const RAW_TASK_BRIEF = `  ${TASK_BRIEF}\n`

const harnessRun = vi.fn()
const createThread = vi.fn()
const deleteThread = vi.fn()
const setThreadAgentId = vi.fn()
const appendUserMessage = vi.fn()
const notify = vi.fn()

/** Run with a zero shell-ready timeout so tests never sit in the poll loop. */
const run = (s: HarnessSummary = summary, taskBrief = RAW_TASK_BRIEF) =>
  runHarness(s, taskBrief, { shellReadyTimeoutMs: 0 })

beforeEach(() => {
  vi.clearAllMocks()
  useThreadStore.setState(useThreadStore.getInitialState())
  useBlockStore.setState(useBlockStore.getInitialState())
  useCliSessionStore.setState({ byThread: {} })
  useAgentDispatchStore.setState(useAgentDispatchStore.getInitialState())
  useThreadStore.setState({
    vaultPath: '/ws',
    createThread: createThread as never,
    deleteThread: deleteThread as never,
    setThreadAgentId: setThreadAgentId as never,
    appendUserMessage: appendUserMessage as never
  })
  harnessRun.mockResolvedValue({ ok: true, prompt: MAIN_PROMPT, adapter: 'claude' })
  createThread.mockResolvedValue({ id: 't1', agent: 'cli-claude' })
  deleteThread.mockResolvedValue(undefined)
  setThreadAgentId.mockResolvedValue(undefined)
  appendUserMessage.mockResolvedValue('accepted')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).api = { harness: { run: harnessRun } }
  setErrorNotifier(notify)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  setErrorNotifier(() => {})
  vi.restoreAllMocks()
})

describe('runHarness', () => {
  it('creates a cli-claude thread titled by the slug WITHOUT an agentId', async () => {
    await run()
    expect(createThread).toHaveBeenCalledTimes(1)
    const [agent, , title, agentId] = createThread.mock.calls[0]
    expect(agent).toBe('cli-claude')
    expect(title).toBe('test-fixer')
    // Attribution is main's: the binding is recorded inside harness:run, so
    // the createThread-time spawn must not forward an unbound agentId.
    expect(agentId).toBeUndefined()
  })

  it('invokes harness:run with the slug and the new thread id, then sends MAIN prompt', async () => {
    const started = await run()
    expect(harnessRun).toHaveBeenCalledTimes(1)
    expect(harnessRun).toHaveBeenCalledWith('test-fixer', 't1', TASK_BRIEF)
    expect(appendUserMessage).toHaveBeenCalledTimes(1)
    expect(appendUserMessage).toHaveBeenCalledWith(MAIN_PROMPT, 't1')
    expect(started).toBe('accepted')
    expect(
      useAgentDispatchStore.getState().harnessLaunchByWorkspace['/ws']?.['test-fixer']
    ).toBeUndefined()
  })

  it('persists the slug as the thread agentId after main records the binding', async () => {
    await run()
    expect(setThreadAgentId).toHaveBeenCalledTimes(1)
    expect(setThreadAgentId).toHaveBeenCalledWith('t1', 'test-fixer')
    // Bound before the first turn is sent.
    expect(setThreadAgentId.mock.invocationCallOrder[0]).toBeLessThan(
      appendUserMessage.mock.invocationCallOrder[0]
    )
  })

  it('deletes the just-created thread and notifies when harness:run refuses', async () => {
    harnessRun.mockResolvedValue({ ok: false, error: 'not-a-real-harness-dir' })
    const started = await run()
    // Net effect "no thread created".
    expect(deleteThread).toHaveBeenCalledTimes(1)
    expect(deleteThread).toHaveBeenCalledWith('t1')
    expect(setThreadAgentId).not.toHaveBeenCalled()
    expect(appendUserMessage).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][0]).toContain('test-fixer')
    expect(notify.mock.calls[0][0]).toContain('run not started')
    expect(started).toBe('refused')
  })

  it('keeps a rejected harness:run indeterminate because main may have bound it', async () => {
    harnessRun.mockRejectedValue(new Error('registry exploded'))
    await expect(run()).resolves.toBe('indeterminate')
    expect(deleteThread).not.toHaveBeenCalled()
    expect(setThreadAgentId).not.toHaveBeenCalled()
    expect(appendUserMessage).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][0]).toContain('status is unknown')
    expect(notify.mock.calls[0][0]).toContain('do not retry')
  })

  it('times out a stalled harness:run without deleting or inviting a retry', async () => {
    vi.useFakeTimers()
    harnessRun.mockReturnValue(new Promise(() => {}))
    const pending = runHarness(summary, RAW_TASK_BRIEF, {
      shellReadyTimeoutMs: 0,
      ipcTimeoutMs: 100
    })
    await vi.advanceTimersByTimeAsync(100)
    await expect(pending).resolves.toBe('indeterminate')
    expect(deleteThread).not.toHaveBeenCalled()
    expect(appendUserMessage).not.toHaveBeenCalled()
    expect(
      useAgentDispatchStore.getState().harnessLaunchByWorkspace['/ws']?.['test-fixer']
    ).toEqual({
      status: 'indeterminate',
      threadId: 't1'
    })
    await expect(run()).resolves.toBe('indeterminate')
    expect(createThread).toHaveBeenCalledOnce()
    expect(harnessRun).toHaveBeenCalledOnce()
  })

  it('cleans the provisional thread when a timed-out harness:run refuses late', async () => {
    vi.useFakeTimers()
    let resolveHarnessRun:
      | ((
          value: { ok: false; error: string } | { ok: true; prompt: string; adapter: 'claude' }
        ) => void)
      | undefined
    harnessRun.mockReturnValue(
      new Promise((resolve) => {
        resolveHarnessRun = resolve
      })
    )
    const pending = runHarness(summary, RAW_TASK_BRIEF, {
      shellReadyTimeoutMs: 0,
      ipcTimeoutMs: 100
    })
    await vi.advanceTimersByTimeAsync(100)
    await expect(pending).resolves.toBe('indeterminate')

    resolveHarnessRun?.({ ok: false, error: 'late refusal' })
    await vi.waitFor(() => expect(deleteThread).toHaveBeenCalledWith('t1'))
    expect(
      useAgentDispatchStore.getState().harnessLaunchByWorkspace['/ws']?.['test-fixer']
    ).toBeUndefined()
    expect(appendUserMessage).not.toHaveBeenCalled()
  })

  it('continues the same launch exactly once when a timed-out harness:run accepts late', async () => {
    vi.useFakeTimers()
    let resolveHarnessRun:
      | ((value: { ok: true; prompt: string; adapter: 'claude' }) => void)
      | undefined
    harnessRun.mockReturnValue(
      new Promise((resolve) => {
        resolveHarnessRun = resolve
      })
    )
    const pending = runHarness(summary, RAW_TASK_BRIEF, {
      shellReadyTimeoutMs: 0,
      ipcTimeoutMs: 100
    })
    await vi.advanceTimersByTimeAsync(100)
    await expect(pending).resolves.toBe('indeterminate')

    resolveHarnessRun?.({ ok: true, prompt: MAIN_PROMPT, adapter: 'claude' })
    await vi.waitFor(() => expect(appendUserMessage).toHaveBeenCalledWith(MAIN_PROMPT, 't1'))

    expect(createThread).toHaveBeenCalledOnce()
    expect(harnessRun).toHaveBeenCalledOnce()
    expect(setThreadAgentId).toHaveBeenCalledOnce()
    expect(appendUserMessage).toHaveBeenCalledOnce()
    expect(
      useAgentDispatchStore.getState().harnessLaunchByWorkspace['/ws']?.['test-fixer']
    ).toBeUndefined()
  })

  it('does not let an unknown launch in workspace A block the same slug in workspace B', async () => {
    vi.useFakeTimers()
    harnessRun.mockReturnValueOnce(new Promise(() => {}))
    const first = runHarness(summary, RAW_TASK_BRIEF, {
      shellReadyTimeoutMs: 0,
      ipcTimeoutMs: 100
    })
    await vi.advanceTimersByTimeAsync(100)
    await expect(first).resolves.toBe('indeterminate')

    useThreadStore.getState().setVaultPath('/workspace-b')
    createThread.mockResolvedValueOnce({ id: 't2', agent: 'cli-claude' })
    harnessRun.mockResolvedValueOnce({ ok: true, prompt: MAIN_PROMPT, adapter: 'claude' })

    await expect(run()).resolves.toBe('accepted')
    expect(createThread).toHaveBeenCalledTimes(2)
    expect(harnessRun).toHaveBeenCalledTimes(2)
  })

  it('refuses before send when main reports an adapter different from the created thread', async () => {
    harnessRun.mockResolvedValue({ ok: true, prompt: MAIN_PROMPT, adapter: 'codex' })
    await expect(run()).resolves.toBe('refused')
    expect(deleteThread).toHaveBeenCalledWith('t1')
    expect(setThreadAgentId).not.toHaveBeenCalled()
    expect(appendUserMessage).not.toHaveBeenCalled()
    expect(notify.mock.calls[0][0]).toContain('changed while opening')
  })

  it('refuses before send when main cannot resolve an authoritative adapter', async () => {
    harnessRun.mockResolvedValue({ ok: true, prompt: MAIN_PROMPT, adapter: null })
    await expect(run()).resolves.toBe('refused')
    expect(deleteThread).toHaveBeenCalledWith('t1')
    expect(appendUserMessage).not.toHaveBeenCalled()
  })

  it('returns refused and removes the provisional thread when first-turn delivery is refused', async () => {
    appendUserMessage.mockResolvedValue('refused')
    await expect(run()).resolves.toBe('refused')
    expect(setThreadAgentId).toHaveBeenCalledWith('t1', 'test-fixer')
    expect(deleteThread).toHaveBeenCalledWith('t1')
  })

  it('preserves the thread when first-turn delivery is indeterminate', async () => {
    appendUserMessage.mockResolvedValue('indeterminate')
    await expect(run()).resolves.toBe('indeterminate')
    expect(deleteThread).not.toHaveBeenCalled()
    expect(notify.mock.calls.at(-1)?.[0]).toMatch(/may still execute.*do not retry/i)
  })

  it('bounds thread creation and marks a late create indeterminate', async () => {
    vi.useFakeTimers()
    createThread.mockReturnValue(new Promise(() => {}))
    const pending = runHarness(summary, RAW_TASK_BRIEF, {
      shellReadyTimeoutMs: 0,
      ipcTimeoutMs: 100
    })
    await vi.advanceTimersByTimeAsync(100)
    await expect(pending).resolves.toBe('indeterminate')
    expect(harnessRun).not.toHaveBeenCalled()
    expect(deleteThread).not.toHaveBeenCalled()
  })

  it('bounds binding persistence and preserves its indeterminate thread', async () => {
    vi.useFakeTimers()
    setThreadAgentId.mockReturnValue(new Promise(() => {}))
    const pending = runHarness(summary, RAW_TASK_BRIEF, {
      shellReadyTimeoutMs: 0,
      ipcTimeoutMs: 100
    })
    await vi.advanceTimersByTimeAsync(100)
    await expect(pending).resolves.toBe('indeterminate')
    expect(appendUserMessage).not.toHaveBeenCalled()
    expect(deleteThread).not.toHaveBeenCalled()
  })

  it('bounds refusal cleanup and does not claim retry is safe when deletion hangs', async () => {
    vi.useFakeTimers()
    harnessRun.mockResolvedValue({ ok: false, error: 'not-a-real-harness-dir' })
    deleteThread.mockReturnValue(new Promise(() => {}))
    const pending = runHarness(summary, RAW_TASK_BRIEF, {
      shellReadyTimeoutMs: 0,
      ipcTimeoutMs: 100
    })
    await vi.advanceTimersByTimeAsync(100)
    await expect(pending).resolves.toBe('indeterminate')
    expect(deleteThread).toHaveBeenCalledWith('t1')
    expect(notify.mock.calls.at(-1)?.[0]).toMatch(/cleanup status is unknown.*do not retry/i)
  })

  it('creates no thread when no workspace is open', async () => {
    useThreadStore.setState({ vaultPath: null })
    await run()
    expect(createThread).not.toHaveBeenCalled()
    expect(harnessRun).not.toHaveBeenCalled()
  })

  it.each(['', ' \n\t ', 'inspect\0secrets', 'x'.repeat(4001)])(
    'rejects an invalid task brief before creating a thread or invoking main',
    async (invalidBrief) => {
      const started = await run(summary, invalidBrief)
      expect(createThread).not.toHaveBeenCalled()
      expect(harnessRun).not.toHaveBeenCalled()
      expect(notify).toHaveBeenCalledOnce()
      expect(started).toBe('refused')
    }
  )

  it('refuses a summary carrying error-severity lint diagnostics (step-7 guard)', async () => {
    await run({
      ...summary,
      diagnostics: [
        { severity: 'error', code: 'scope-protected-globs', message: 'm', file: 'scope.json' }
      ]
    })
    expect(createThread).not.toHaveBeenCalled()
    expect(harnessRun).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][0]).toContain('run disabled')
  })

  it('refuses a summary with no readable adapter (frontmatter-invalid harness)', async () => {
    await run({ ...summary, adapter: null })
    expect(createThread).not.toHaveBeenCalled()
    expect(harnessRun).not.toHaveBeenCalled()
  })

  it('waits for the created thread PTY and ignores an unrelated new session', async () => {
    let targetPromptSeen = false
    createThread.mockImplementation(async () => {
      useCliSessionStore.getState().seed('t1', 'target-session')
      setTimeout(() => {
        useBlockStore.getState().applyUpdate('unrelated-session', {
          id: 'other-block',
          state: { kind: 'pending' },
          command: '',
          outputText: '',
          metadata: { sessionId: 'unrelated-session', cwd: '/ws' }
        } as unknown as Block)
      }, 25)
      setTimeout(() => {
        targetPromptSeen = true
        useBlockStore.getState().applyUpdate('target-session', {
          id: 'b1',
          state: { kind: 'pending' },
          command: '',
          outputText: '',
          metadata: { sessionId: 'target-session', cwd: '/ws' }
        } as unknown as Block)
      }, 75)
      return { id: 't1', agent: 'cli-claude' }
    })
    let targetSeenWhenSent = false
    appendUserMessage.mockImplementation(async () => {
      targetSeenWhenSent = targetPromptSeen
      return 'accepted'
    })
    await runHarness(summary, RAW_TASK_BRIEF, { shellReadyTimeoutMs: 5000 })
    expect(appendUserMessage).toHaveBeenCalledTimes(1)
    expect(targetSeenWhenSent).toBe(true)
  })

  it('keeps the first prompt on the created harness thread when selection changes while waiting', async () => {
    const harnessThread: Thread = {
      id: 't1',
      agent: 'cli-claude',
      model: 'claude-sonnet-4-6',
      started: '2026-07-09T00:00:00.000Z',
      lastMessage: '2026-07-09T00:00:00.000Z',
      title: 'test-fixer',
      dockState: { tabs: [] },
      messages: []
    }
    const otherThread: Thread = {
      ...harnessThread,
      id: 'other',
      title: 'Other thread'
    }
    const cliInput = vi.fn().mockResolvedValue({ ok: true })
    const save = vi.fn().mockResolvedValue(undefined)
    const realActions = useThreadStore.getInitialState()

    // Exercise the real persistence + transport action. createThread still
    // stays mocked so this remains a renderer-ordering test, not an IPC test.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).api = {
      harness: { run: harnessRun },
      thread: { save },
      cliThread: { input: cliInput }
    }
    useThreadStore.setState({
      vaultPath: '/ws',
      activeThreadId: 'other',
      threadsById: { other: otherThread },
      createThread: createThread as never,
      deleteThread: deleteThread as never,
      setThreadAgentId: realActions.setThreadAgentId,
      appendUserMessage: realActions.appendUserMessage
    })
    createThread.mockImplementation(async () => {
      useThreadStore.setState((state) => ({
        activeThreadId: harnessThread.id,
        threadsById: { ...state.threadsById, [harnessThread.id]: harnessThread }
      }))
      useCliSessionStore.getState().seed(harnessThread.id, 'fresh-session')
      setTimeout(() => {
        // The user changes selection while runHarness is waiting for the
        // fresh shell prompt. That UI choice must not retarget the run.
        useThreadStore.setState({ activeThreadId: otherThread.id })
        useBlockStore.getState().applyUpdate('fresh-session', {
          id: 'b1',
          state: { kind: 'pending' },
          command: '',
          outputText: '',
          metadata: { sessionId: 'fresh-session', cwd: '/ws' }
        } as unknown as Block)
      }, 25)
      return harnessThread
    })

    await runHarness(summary, RAW_TASK_BRIEF, { shellReadyTimeoutMs: 5000 })

    expect(useThreadStore.getState().activeThreadId).toBe(otherThread.id)
    expect(cliInput).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: harnessThread.id, text: MAIN_PROMPT })
    )
    expect(useThreadStore.getState().threadsById[harnessThread.id].messages).toEqual([
      expect.objectContaining({ role: 'user', body: MAIN_PROMPT })
    ])
    expect(useThreadStore.getState().threadsById[otherThread.id].messages).toEqual([])
  })
})
