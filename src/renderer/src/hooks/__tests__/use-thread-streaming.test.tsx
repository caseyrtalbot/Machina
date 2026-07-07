import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, act, waitFor } from '@testing-library/react'
import { useThreadStore } from '../../store/thread-store'
import { useThreadStreaming } from '../use-thread-streaming'
import { AUTH_ERROR_BODY } from '../../panels/agent-shell/ThreadMessage'
import type { Thread, ThreadMessage } from '@shared/thread-types'

function Harness() {
  useThreadStreaming()
  return null
}

const thread = (id: string): Thread => ({
  id,
  agent: 'cli-claude',
  model: 'claude-sonnet-4-6',
  started: '2026-06-01T00:00:00Z',
  lastMessage: '2026-06-01T00:00:00Z',
  title: id,
  dockState: { tabs: [] },
  messages: []
})

const interimDelta = (body: string): ThreadMessage => ({
  role: 'assistant',
  body,
  sentAt: '2026-06-01T00:00:01Z',
  metadata: { sessionId: 's1', startedAt: '2026-06-01T00:00:00Z' }
})

const finalMessage = (body: string): ThreadMessage => ({
  role: 'assistant',
  body,
  sentAt: '2026-06-01T00:00:00Z',
  toolCalls: [
    {
      call: { id: 'c1', kind: 'cli_command', args: { command: "claude --print 'hi'", cwd: '/v' } },
      result: { id: 'c1', ok: true, output: { output: 'raw', exitCode: 0 } }
    }
  ],
  metadata: {
    sessionId: 's1',
    startedAt: '2026-06-01T00:00:00Z',
    endedAt: '2026-06-01T00:00:05Z'
  }
})

// Captured event callbacks (the hook subscribes on mount).
let cliCb: ((evt: { threadId: string; message: ThreadMessage }) => void) | null = null
let nativeCb: ((evt: unknown) => void) | null = null

beforeEach(() => {
  useThreadStore.setState(useThreadStore.getInitialState())
  useThreadStore.setState({
    vaultPath: '/v',
    activeThreadId: 'a',
    threadsById: { a: thread('a') },
    inFlightByThreadId: { a: true }
  })
  cliCb = null
  nativeCb = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).api = {
    thread: { save: vi.fn().mockResolvedValue(undefined) },
    on: {
      agentNativeEvent: vi.fn((cb: (evt: unknown) => void) => {
        nativeCb = cb
        return () => {}
      }),
      threadCliMessage: vi.fn((cb: (evt: { threadId: string; message: ThreadMessage }) => void) => {
        cliCb = cb
        return () => {}
      }),
      agentNativeDockAction: vi.fn(() => () => {})
    }
  }
})

describe('useThreadStreaming — CLI structured replies', () => {
  it('buffers interim deltas, then finalizes with the full body and tool calls', async () => {
    render(<Harness />)
    act(() => cliCb!({ threadId: 'a', message: interimDelta('Hello') }))
    expect(useThreadStore.getState().streamingByThreadId['a']).toBe('Hello')

    act(() => cliCb!({ threadId: 'a', message: interimDelta('\n\nMore') }))
    expect(useThreadStore.getState().streamingByThreadId['a']).toBe('Hello\n\nMore')

    await act(async () => cliCb!({ threadId: 'a', message: finalMessage('Hello\n\nMore\n\nTail') }))
    await waitFor(() => {
      expect(useThreadStore.getState().threadsById['a'].messages).toHaveLength(1)
    })
    const st = useThreadStore.getState()
    const msg = st.threadsById['a'].messages[0]
    expect(msg.role).toBe('assistant')
    expect(msg.body).toBe('Hello\n\nMore\n\nTail')
    if (msg.role === 'assistant') {
      expect(msg.toolCalls?.map((tc) => tc.call.kind)).toEqual(['cli_command'])
    }
    // Streaming state is fully cleared — no stale buffer duplicating the body.
    expect(st.streamingByThreadId['a']).toBeUndefined()
    expect(st.runIdByThreadId['a']).toBeUndefined()
    expect(st.inFlightByThreadId['a']).toBeUndefined()
  })

  it('appends a non-streamed final message as-is (metadata preserved)', async () => {
    render(<Harness />)
    await act(async () => cliCb!({ threadId: 'a', message: finalMessage('plain reply') }))
    await waitFor(() => {
      expect(useThreadStore.getState().threadsById['a'].messages).toHaveLength(1)
    })
    const msg = useThreadStore.getState().threadsById['a'].messages[0]
    expect(msg.body).toBe('plain reply')
    if (msg.role === 'assistant') {
      expect(msg.metadata?.endedAt).toBe('2026-06-01T00:00:05Z')
    }
    expect(useThreadStore.getState().inFlightByThreadId['a']).toBeUndefined()
  })
})

describe('useThreadStreaming — native segment joins', () => {
  const toolEvent = {
    kind: 'tool_call_persisted',
    threadId: 'a',
    runId: 'r1',
    call: { id: 'c1', kind: 'read_note', args: { path: 'x.md' } },
    result: { id: 'c1', ok: true, output: 'body' }
  }

  it('inserts a paragraph break when prose resumes after a tool call', () => {
    useThreadStore.setState({ runIdByThreadId: { a: 'r1' } })
    render(<Harness />)
    act(() =>
      nativeCb!({ kind: 'text', text: 'Let me look at your vault.', threadId: 'a', runId: 'r1' })
    )
    act(() => nativeCb!(toolEvent))
    act(() => nativeCb!({ kind: 'text', text: 'Good, I found it.', threadId: 'a', runId: 'r1' }))
    expect(useThreadStore.getState().streamingByThreadId['a']).toBe(
      'Let me look at your vault.\n\nGood, I found it.'
    )
  })

  it('does not stack separators across consecutive tool calls or add one before any text', () => {
    useThreadStore.setState({ runIdByThreadId: { a: 'r1' } })
    render(<Harness />)
    act(() => nativeCb!(toolEvent))
    expect(useThreadStore.getState().streamingByThreadId['a'] ?? '').toBe('')

    act(() => nativeCb!({ kind: 'text', text: 'First segment.', threadId: 'a', runId: 'r1' }))
    act(() => nativeCb!(toolEvent))
    act(() => nativeCb!(toolEvent))
    expect(useThreadStore.getState().streamingByThreadId['a']).toBe('First segment.\n\n')
  })
})

describe('useThreadStreaming — native agent errors', () => {
  it('renders an AUTH failure as a system message instead of a raw error dump', async () => {
    useThreadStore.setState({ runIdByThreadId: { a: 'r1' } })
    render(<Harness />)
    await act(async () =>
      nativeCb!({
        kind: 'error',
        code: 'AUTH',
        message: '401 unauthorized',
        threadId: 'a',
        runId: 'r1'
      })
    )
    await waitFor(() => {
      expect(useThreadStore.getState().threadsById['a'].messages).toHaveLength(1)
    })
    const st = useThreadStore.getState()
    const msg = st.threadsById['a'].messages[0]
    expect(msg.role).toBe('system')
    expect(msg.body).toBe(AUTH_ERROR_BODY)
    expect(st.inFlightByThreadId['a']).toBeUndefined()
    expect(st.runIdByThreadId['a']).toBeUndefined()
  })

  it('renders a non-AUTH failure as a system message instead of inline bracket text', async () => {
    useThreadStore.setState({ runIdByThreadId: { a: 'r1' } })
    render(<Harness />)
    await act(async () =>
      nativeCb!({
        kind: 'error',
        code: 'RATE_LIMIT',
        message: 'slow down',
        threadId: 'a',
        runId: 'r1'
      })
    )
    await waitFor(() => {
      expect(useThreadStore.getState().threadsById['a'].messages).toHaveLength(1)
    })
    const st = useThreadStore.getState()
    const msg = st.threadsById['a'].messages[0]
    expect(msg.role).toBe('system')
    expect(msg.body).toBe('The agent run failed (RATE_LIMIT): slow down')
    expect(st.runIdByThreadId['a']).toBeUndefined()
    expect(st.inFlightByThreadId['a']).toBeUndefined()
  })

  it('materializes partial streamed text before the non-AUTH system message', async () => {
    useThreadStore.setState({ runIdByThreadId: { a: 'r1' } })
    render(<Harness />)
    act(() => nativeCb!({ kind: 'text', text: 'Partial answer.', threadId: 'a', runId: 'r1' }))
    await act(async () =>
      nativeCb!({
        kind: 'error',
        code: 'RATE_LIMIT',
        message: 'slow down',
        threadId: 'a',
        runId: 'r1'
      })
    )
    await waitFor(() => {
      expect(useThreadStore.getState().threadsById['a'].messages).toHaveLength(2)
    })
    const msgs = useThreadStore.getState().threadsById['a'].messages
    expect(msgs[0].role).toBe('assistant')
    expect(msgs[0].body).toBe('Partial answer.')
    expect(msgs[1].role).toBe('system')
    expect(msgs[1].body).toBe('The agent run failed (RATE_LIMIT): slow down')
  })
})
