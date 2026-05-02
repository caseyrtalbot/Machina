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
