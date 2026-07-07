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
import { runHarness } from '../harness-run'
import { setErrorNotifier } from '../../utils/error-logger'
import type { HarnessSummary } from '@shared/harness-types'
import type { Block } from '@shared/engine/block-model'

const summary: HarnessSummary = {
  slug: 'test-fixer',
  name: 'test-fixer',
  description: 'Runs the test suite, fixes the first failure, stops.',
  adapter: 'claude'
}

/** Whatever main composed is what gets sent — the renderer never rebuilds it. */
const MAIN_PROMPT = 'MAIN-COMPOSED HARNESS PROMPT'

const harnessRun = vi.fn()
const createThread = vi.fn()
const deleteThread = vi.fn()
const setThreadAgentId = vi.fn()
const appendUserMessage = vi.fn()
const notify = vi.fn()

/** Run with a zero shell-ready timeout so tests never sit in the poll loop. */
const run = (s: HarnessSummary = summary) => runHarness(s, { shellReadyTimeoutMs: 0 })

beforeEach(() => {
  vi.clearAllMocks()
  useThreadStore.setState(useThreadStore.getInitialState())
  useBlockStore.setState(useBlockStore.getInitialState())
  useThreadStore.setState({
    vaultPath: '/ws',
    createThread: createThread as never,
    deleteThread: deleteThread as never,
    setThreadAgentId: setThreadAgentId as never,
    appendUserMessage: appendUserMessage as never
  })
  harnessRun.mockResolvedValue({ ok: true, prompt: MAIN_PROMPT })
  createThread.mockResolvedValue({ id: 't1' })
  deleteThread.mockResolvedValue(undefined)
  setThreadAgentId.mockResolvedValue(undefined)
  appendUserMessage.mockResolvedValue(undefined)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).api = { harness: { run: harnessRun } }
  setErrorNotifier(notify)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
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
    await run()
    expect(harnessRun).toHaveBeenCalledTimes(1)
    expect(harnessRun).toHaveBeenCalledWith('test-fixer', 't1')
    expect(appendUserMessage).toHaveBeenCalledTimes(1)
    expect(appendUserMessage).toHaveBeenCalledWith(MAIN_PROMPT)
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
    await run()
    // Net effect "no thread created".
    expect(deleteThread).toHaveBeenCalledTimes(1)
    expect(deleteThread).toHaveBeenCalledWith('t1')
    expect(setThreadAgentId).not.toHaveBeenCalled()
    expect(appendUserMessage).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][0]).toContain('test-fixer')
    expect(notify.mock.calls[0][0]).toContain('run not started')
  })

  it('cleans up identically when the harness:run invoke REJECTS (main-side throw)', async () => {
    harnessRun.mockRejectedValue(new Error('registry exploded'))
    await run()
    expect(deleteThread).toHaveBeenCalledTimes(1)
    expect(deleteThread).toHaveBeenCalledWith('t1')
    expect(setThreadAgentId).not.toHaveBeenCalled()
    expect(appendUserMessage).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][0]).toContain('run not started')
  })

  it('creates no thread when no workspace is open', async () => {
    useThreadStore.setState({ vaultPath: null })
    await run()
    expect(createThread).not.toHaveBeenCalled()
    expect(harnessRun).not.toHaveBeenCalled()
  })

  it('waits for the fresh PTY session to draw a prompt before sending the first turn', async () => {
    // createThread's spawn side effect: the new session's first (pending)
    // block lands in block-store shortly after. The first turn must not be
    // typed before that — the shell hooks are not live yet.
    let sessionSeeded = false
    createThread.mockImplementation(async () => {
      setTimeout(() => {
        sessionSeeded = true
        useBlockStore.getState().applyUpdate('fresh-session', {
          id: 'b1',
          state: { kind: 'pending' },
          command: '',
          outputText: '',
          metadata: { sessionId: 'fresh-session', cwd: '/ws' }
        } as unknown as Block)
      }, 50)
      return { id: 't1' }
    })
    let seededWhenSent = false
    appendUserMessage.mockImplementation(async () => {
      seededWhenSent = sessionSeeded
    })
    await runHarness(summary, { shellReadyTimeoutMs: 5000 })
    expect(appendUserMessage).toHaveBeenCalledTimes(1)
    expect(seededWhenSent).toBe(true)
  })
})
