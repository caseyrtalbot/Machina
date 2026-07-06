import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useThreadStore } from '../../../store/thread-store'
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
    }
  }
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

  it('disables input with honest copy on raw threads and never sends', () => {
    useThreadStore.setState({
      vaultPath: '/v',
      activeThreadId: 'a',
      threadsById: { a: thread('a', { agent: 'cli-raw' }) }
    })
    render(<ThreadInputBar />)
    const ta = screen.getByPlaceholderText(/no structured view/i) as HTMLTextAreaElement
    expect(ta.disabled).toBe(true)
    // Even a synthetic Enter (fireEvent bypasses browser disabled semantics)
    // must not append a message on a raw thread.
    fireEvent.change(ta, { target: { value: 'hello' } })
    fireEvent.keyDown(ta, { key: 'Enter' })
    expect(useThreadStore.getState().threadsById['a'].messages).toHaveLength(0)
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
