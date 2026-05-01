import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useThreadStore } from '../../../store/thread-store'
import { useVaultStore } from '../../../store/vault-store'
import { ThreadSidebar } from '../ThreadSidebar'
import type { Thread } from '@shared/thread-types'

const thread = (
  id: string,
  title: string,
  agent: Thread['agent'],
  lastMessage: string
): Thread => ({
  id,
  agent,
  model: 'm',
  started: '2026-05-01T00:00:00Z',
  lastMessage,
  title,
  dockState: { tabs: [] },
  messages: []
})

beforeEach(() => {
  useThreadStore.setState(useThreadStore.getInitialState())
  useVaultStore.setState({ vaultPath: '/v' })
  useThreadStore.setState({
    vaultPath: '/v',
    threadsById: {
      a: thread('a', 'Thread A', 'machina-native', '2026-05-01T10:00:00Z'),
      b: thread('b', 'Thread B', 'cli-claude', '2026-05-01T11:00:00Z')
    },
    activeThreadId: 'a'
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).api = {
    thread: {
      save: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      archive: vi.fn().mockResolvedValue(undefined),
      unarchive: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined)
    }
  }
})

describe('ThreadSidebar', () => {
  it('renders threads sorted by lastMessage desc', () => {
    render(<ThreadSidebar />)
    const rows = screen.getAllByTestId('thread-row')
    expect(rows[0].textContent).toContain('Thread B')
    expect(rows[1].textContent).toContain('Thread A')
  })

  it('shows agent tag for each thread', () => {
    render(<ThreadSidebar />)
    expect(screen.getByText('claude')).toBeTruthy()
    expect(screen.getByText('native')).toBeTruthy()
  })

  it('clicking a row calls selectThread', async () => {
    render(<ThreadSidebar />)
    const rowB = screen.getAllByTestId('thread-row')[0]
    fireEvent.click(rowB)
    await vi.waitFor(() => {
      expect(useThreadStore.getState().activeThreadId).toBe('b')
    })
  })
})
