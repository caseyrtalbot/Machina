import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useThreadStore } from '../thread-store'
import type { Thread } from '@shared/thread-types'

const sampleThread = (id: string, tabs: Thread['dockState']['tabs']): Thread => ({
  id,
  agent: 'machina-native',
  model: 'claude-sonnet-4-6',
  started: '2026-05-01T13:00:00Z',
  lastMessage: '2026-05-01T13:00:00Z',
  title: 'Sample',
  dockState: { tabs },
  messages: []
})

beforeEach(() => {
  useThreadStore.setState(useThreadStore.getInitialState())
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
    fs: {
      fileExists: vi.fn().mockResolvedValue(true)
    }
  }
})

describe('dock restore', () => {
  it('selectThread leaves dock tabs from the thread in place', async () => {
    useThreadStore.getState().setVaultPath('/v')
    useThreadStore.setState({
      threadsById: { a: sampleThread('a', [{ kind: 'graph' }]) },
      dockTabsByThreadId: { a: [{ kind: 'graph' }] }
    })
    await useThreadStore.getState().selectThread('a')
    expect(useThreadStore.getState().dockTabsByThreadId['a']).toEqual([{ kind: 'graph' }])
    expect(useThreadStore.getState().activeThreadId).toBe('a')
  })

  it('selectThread preserves multi-kind tab layouts across switches', async () => {
    useThreadStore.getState().setVaultPath('/v')
    useThreadStore.setState({
      threadsById: {
        a: sampleThread('a', [{ kind: 'graph' }]),
        b: sampleThread('b', [{ kind: 'editor', path: '/v/note.md' }, { kind: 'health' }])
      },
      dockTabsByThreadId: {
        a: [{ kind: 'graph' }],
        b: [{ kind: 'editor', path: '/v/note.md' }, { kind: 'health' }]
      }
    })
    await useThreadStore.getState().selectThread('b')
    expect(useThreadStore.getState().dockTabsByThreadId['b']).toEqual([
      { kind: 'editor', path: '/v/note.md' },
      { kind: 'health' }
    ])
    await useThreadStore.getState().selectThread('a')
    expect(useThreadStore.getState().dockTabsByThreadId['a']).toEqual([{ kind: 'graph' }])
    expect(useThreadStore.getState().dockTabsByThreadId['b']).toEqual([
      { kind: 'editor', path: '/v/note.md' },
      { kind: 'health' }
    ])
  })
})
