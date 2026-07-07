import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useThreadStore } from '../../../store/thread-store'
import { useApprovalsStore } from '../../../store/approvals-store'
import { ThreadPanel } from '../ThreadPanel'
import type { Thread, ToolCall } from '@shared/thread-types'

const baseThread: Thread = {
  id: 't1',
  agent: 'machina-native',
  model: 'claude-sonnet-4-6',
  started: '2026-05-01T00:00:00Z',
  lastMessage: '2026-05-01T00:00:00Z',
  title: 'New thread',
  dockState: { tabs: [] },
  messages: [{ role: 'user', body: 'Surprise me.', sentAt: '' }]
}

beforeEach(() => {
  useThreadStore.setState(useThreadStore.getInitialState())
  useApprovalsStore.setState(useApprovalsStore.getInitialState())
  useThreadStore.setState({
    vaultPath: '/v',
    threadsById: { t1: { ...baseThread } },
    activeThreadId: 't1'
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).api = {
    agentNative: { toolDecision: vi.fn().mockResolvedValue(undefined) },
    // CLI-thread headers mount HarnessIdentityChip; unbound keeps it hidden.
    harness: { binding: vi.fn().mockResolvedValue(null) }
  }
})

describe('ThreadPanel in-flight rendering', () => {
  it('renders streaming text as a ghost assistant message when the last message is a user', () => {
    useThreadStore.setState({ streamingByThreadId: { t1: 'thinking…' } })
    render(<ThreadPanel />)
    // ghost article is identified by data-inflight=true
    const inflight = document.querySelector('article[data-inflight="true"]')
    expect(inflight).toBeTruthy()
    expect(inflight?.textContent).toContain('thinking…')
  })

  it('renders a pending write_note approval card so the user can decide', () => {
    const call: ToolCall = {
      id: 'tu_1',
      kind: 'write_note',
      args: { path: 'Notes/Random.md', content: 'fresh note body' }
    }
    useThreadStore.setState({ pendingToolCallsByThreadId: { t1: [{ call }] } })
    render(<ThreadPanel />)
    expect(screen.getByText('Notes/Random.md')).toBeTruthy()
    expect(screen.getByText('Accept')).toBeTruthy()
    expect(screen.getByText('Reject')).toBeTruthy()
    expect(screen.getByText('awaiting approval')).toBeTruthy()
  })

  it('does NOT render a ghost when there is no in-flight state', () => {
    render(<ThreadPanel />)
    expect(document.querySelector('article[data-inflight="true"]')).toBeNull()
  })

  it('does NOT render a ghost when the last message is already an assistant (avoids double-render)', () => {
    useThreadStore.setState({
      threadsById: {
        t1: {
          ...baseThread,
          messages: [...baseThread.messages, { role: 'assistant', body: 'done', sentAt: '' }]
        }
      },
      streamingByThreadId: { t1: 'late chunk' }
    })
    render(<ThreadPanel />)
    expect(document.querySelector('article[data-inflight="true"]')).toBeNull()
  })
})

describe('ThreadPanel watcher-health chip (contracts §4 v1.2.1)', () => {
  const unhealthy = {
    state: 'down',
    since: '2026-07-06T00:00:00.000Z',
    attempts: 0
  } as const

  it('shows the degraded chip on CLI threads while the watcher is unhealthy', () => {
    useThreadStore.setState({
      threadsById: { t1: { ...baseThread, agent: 'cli-claude' } }
    })
    useApprovalsStore.setState({ watcherHealth: unhealthy })
    render(<ThreadPanel />)
    expect(screen.getByTestId('thread-watcher-chip').textContent).toBe('containment down')
  })

  it('never shows the chip on machina-native threads (its writes are pre-gated)', () => {
    useApprovalsStore.setState({ watcherHealth: unhealthy })
    render(<ThreadPanel />)
    expect(screen.queryByTestId('thread-watcher-chip')).toBeNull()
  })
})
