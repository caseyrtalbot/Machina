import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useThreadStore } from '../../../store/thread-store'
import { useAgentDispatchStore } from '../../../store/agent-dispatch-store'
import { ThreadInputBar } from '../ThreadInputBar'
import type { Thread, ThreadMessage } from '@shared/thread-types'

const thread = (id: string, overrides: Partial<Thread> = {}): Thread => ({
  id,
  agent: 'machina-native',
  model: 'claude-sonnet-4-6',
  started: '2026-05-01T00:00:00Z',
  lastMessage: '2026-05-01T00:00:00Z',
  title: id,
  dockState: { tabs: [] },
  messages: [],
  ...overrides
})

beforeEach(() => {
  useThreadStore.setState(useThreadStore.getInitialState())
  useAgentDispatchStore.setState(useAgentDispatchStore.getInitialState())
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).api = {
    thread: { save: vi.fn().mockResolvedValue(undefined) },
    agentNative: {
      run: vi.fn().mockResolvedValue({ runId: 'r-1' }),
      abort: vi.fn().mockResolvedValue(undefined)
    },
    cliThread: {
      input: vi.fn().mockResolvedValue({ ok: true }),
      cancel: vi.fn().mockResolvedValue({ ok: true })
    },
    harness: {
      binding: vi.fn().mockResolvedValue(null)
    }
  }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ThreadInputBar', () => {
  it('opens the agent picker when "/" is typed on an existing non-empty thread', () => {
    const userMsg: ThreadMessage = { role: 'user', body: 'hi', sentAt: '2026-05-01T00:00:00Z' }
    useThreadStore.setState({
      vaultPath: '/v',
      activeThreadId: 'a',
      threadsById: { a: thread('a', { messages: [userMsg] }) }
    })
    render(<ThreadInputBar />)
    const ta = screen.getByPlaceholderText(/Ask anything/i) as HTMLTextAreaElement
    fireEvent.keyDown(ta, { key: '/' })
    // AgentPicker mounts; cancel button is part of it.
    expect(screen.getByText(/Cancel/i)).toBeTruthy()
  })

  it('shows a model selector for native threads and updates the thread model', async () => {
    useThreadStore.setState({
      vaultPath: '/v',
      activeThreadId: 'a',
      threadsById: { a: thread('a') }
    })
    render(<ThreadInputBar />)
    const select = screen.getByTestId('thread-model-select') as HTMLSelectElement
    expect(select.value).toBe('claude-sonnet-4-6')
    fireEvent.change(select, { target: { value: 'claude-opus-4-8' } })
    await vi.waitFor(() => {
      expect(useThreadStore.getState().threadsById['a'].model).toBe('claude-opus-4-8')
    })
  })

  it('offers the adapter roster behind a default entry for cli-claude threads', async () => {
    // Fresh CLI threads persist the DEFAULT_NATIVE_MODEL filler — the picker
    // must show 'default' (the adapter default runs), never the filler's name.
    useThreadStore.setState({
      vaultPath: '/v',
      activeThreadId: 'a',
      threadsById: { a: thread('a', { agent: 'cli-claude' }) }
    })
    render(<ThreadInputBar />)
    const select = screen.getByTestId('thread-model-select') as HTMLSelectElement
    expect(select.value).toBe('claude-sonnet-4-6')
    const options = Array.from(select.options).map((o) => [o.value, o.textContent])
    expect(options).toEqual([
      ['claude-sonnet-4-6', 'default'],
      ['fable', 'fable'],
      ['opus', 'opus'],
      ['sonnet', 'sonnet'],
      ['haiku', 'haiku']
    ])
    fireEvent.change(select, { target: { value: 'sonnet' } })
    await vi.waitFor(() => {
      expect(useThreadStore.getState().threadsById['a'].model).toBe('sonnet')
    })
  })

  it('shows an explicitly picked CLI model as the selected value', () => {
    useThreadStore.setState({
      vaultPath: '/v',
      activeThreadId: 'a',
      threadsById: { a: thread('a', { agent: 'cli-codex', model: 'gpt-5.5' }) }
    })
    render(<ThreadInputBar />)
    const select = screen.getByTestId('thread-model-select') as HTMLSelectElement
    expect(select.value).toBe('gpt-5.5')
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      'claude-sonnet-4-6',
      'gpt-5.5',
      'gpt-5.4'
    ])
  })

  it('hides the model selector for adapters with an empty roster (gemini) and for raw', () => {
    useThreadStore.setState({
      vaultPath: '/v',
      activeThreadId: 'a',
      threadsById: { a: thread('a', { agent: 'cli-gemini' }) }
    })
    const { unmount } = render(<ThreadInputBar />)
    expect(screen.queryByTestId('thread-model-select')).toBeNull()
    unmount()
    useThreadStore.setState({
      threadsById: { a: thread('a', { agent: 'cli-raw' }) }
    })
    render(<ThreadInputBar />)
    expect(screen.queryByTestId('thread-model-select')).toBeNull()
  })

  it('disables input with honest copy on raw threads and never sends', async () => {
    useThreadStore.setState({
      vaultPath: '/v',
      activeThreadId: 'a',
      threadsById: { a: thread('a', { agent: 'cli-raw' }) }
    })
    render(<ThreadInputBar />)
    const ta = (await screen.findByPlaceholderText(/no structured view/i)) as HTMLTextAreaElement
    expect(ta.disabled).toBe(true)
    // Even a synthetic Enter (fireEvent bypasses browser disabled semantics)
    // must not append a message on a raw thread.
    fireEvent.change(ta, { target: { value: 'hello' } })
    fireEvent.keyDown(ta, { key: 'Enter' })
    expect(useThreadStore.getState().threadsById['a'].messages).toHaveLength(0)
  })

  it('enables structured input for a harness-bound raw thread and forwards its agentId', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).api.harness.binding.mockResolvedValue({
      slug: 'local-raw-tool',
      adapter: 'raw',
      rawInvocationReady: true
    })
    useThreadStore.setState({
      vaultPath: '/v',
      activeThreadId: 'a',
      threadsById: {
        a: thread('a', { agent: 'cli-raw', agentId: 'local-raw-tool' })
      }
    })
    render(<ThreadInputBar />)
    const ta = (await screen.findByPlaceholderText(/Ask anything/i)) as HTMLTextAreaElement
    expect(ta.disabled).toBe(false)
    fireEvent.change(ta, { target: { value: 'inspect this input' } })
    fireEvent.keyDown(ta, { key: 'Enter' })
    await vi.waitFor(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((window as any).api.cliThread.input).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: 'a',
          identity: 'cli-raw',
          agentId: 'local-raw-tool',
          text: 'inspect this input'
        })
      )
    })
  })

  it.each([
    [{ slug: 'local-raw-tool', adapter: 'raw', rawInvocationReady: false }, /input is not ready/i],
    [{ slug: 'local-raw-tool', adapter: 'codex', rawInvocationReady: true }, /input is not ready/i],
    [{ slug: 'other-tool', adapter: 'raw', rawInvocationReady: true }, /no structured view/i]
  ])('requires exact main-owned raw readiness before enabling input', async (binding, copy) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).api.harness.binding.mockResolvedValue(binding)
    useThreadStore.setState({
      vaultPath: '/v',
      activeThreadId: 'a',
      threadsById: {
        a: thread('a', { agent: 'cli-raw', agentId: 'local-raw-tool' })
      }
    })
    render(<ThreadInputBar />)
    const ta = (await screen.findByPlaceholderText(copy)) as HTMLTextAreaElement
    expect(ta.disabled).toBe(true)
  })

  it('times out binding lookup closed with recoverable retry copy', async () => {
    vi.useFakeTimers()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).api.harness.binding.mockReturnValue(new Promise(() => {}))
    useThreadStore.setState({
      vaultPath: '/v',
      activeThreadId: 'a',
      threadsById: {
        a: thread('a', { agent: 'cli-raw', agentId: 'local-raw-tool' })
      }
    })
    render(<ThreadInputBar />)
    expect(screen.getByPlaceholderText(/checking the main-owned/i)).toBeTruthy()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    const ta = screen.getByPlaceholderText(/switch threads and return to retry/i)
    expect((ta as HTMLTextAreaElement).disabled).toBe(true)
  })

  it('a forged persisted raw agentId cannot enable input without a main binding', async () => {
    useThreadStore.setState({
      vaultPath: '/v',
      activeThreadId: 'a',
      threadsById: {
        a: thread('a', { agent: 'cli-raw', agentId: 'forged-raw-tool' })
      }
    })
    render(<ThreadInputBar />)

    const ta = (await screen.findByPlaceholderText(/no structured view/i)) as HTMLTextAreaElement
    expect(ta.disabled).toBe(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).api.cliThread.input).not.toHaveBeenCalled()
  })

  it('Stop button is hidden when no run is in flight', () => {
    useThreadStore.setState({
      vaultPath: '/v',
      activeThreadId: 'a',
      threadsById: { a: thread('a') }
    })
    render(<ThreadInputBar />)
    expect(screen.queryByTestId('thread-input-stop')).toBeNull()
  })

  it.each([
    ['starting', /starting the agent session/i],
    ['indeterminate', /session start status is unknown/i]
  ] as const)('blocks input while thread session start is %s', (status, copy) => {
    useThreadStore.setState({
      vaultPath: '/v',
      activeThreadId: 'a',
      threadsById: { a: thread('a', { agent: 'cli-claude' }) }
    })
    useAgentDispatchStore.getState().setThreadStart('a', status)
    render(<ThreadInputBar />)
    const input = screen.getByPlaceholderText(copy) as HTMLTextAreaElement
    expect(input.disabled).toBe(true)
    fireEvent.change(input, { target: { value: 'do not send' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).api.cliThread.input).not.toHaveBeenCalled()
    expect(useThreadStore.getState().threadsById['a'].messages).toEqual([])
  })

  it('Stop button appears while in flight; clicking calls agentNative.abort with the runId', async () => {
    useThreadStore.setState({
      vaultPath: '/v',
      activeThreadId: 'a',
      threadsById: { a: thread('a') },
      runIdByThreadId: { a: 'r-9' },
      inFlightByThreadId: { a: true }
    })
    render(<ThreadInputBar />)
    fireEvent.click(screen.getByTestId('thread-input-stop'))
    await vi.waitFor(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((window as any).api.agentNative.abort).toHaveBeenCalledWith('r-9')
    })
  })

  it('Stop button on a CLI thread calls cliThread.cancel with the threadId', async () => {
    useThreadStore.setState({
      vaultPath: '/v',
      activeThreadId: 'a',
      threadsById: { a: thread('a', { agent: 'cli-claude' }) },
      inFlightByThreadId: { a: true }
    })
    render(<ThreadInputBar />)
    fireEvent.click(screen.getByTestId('thread-input-stop'))
    await vi.waitFor(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((window as any).api.cliThread.cancel).toHaveBeenCalledWith('a')
    })
  })
})
