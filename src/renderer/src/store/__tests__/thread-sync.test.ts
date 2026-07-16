/**
 * thread:changed renderer refresh (Phase 3 step 4, contracts §4/§6 v1.3.3):
 * handleThreadChanged re-reads ONE thread from disk and replaces only
 * messages + lastMessage — renderer metadata is kept, foreign roots and
 * unknown threads are ignored, and a workspace switch mid-read drops the
 * stale refresh (token discipline).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Thread, ThreadMessage } from '@shared/thread-types'

const readMock = vi.fn<(vaultPath: string, id: string) => Promise<Thread | null>>()
;(window as unknown as Record<string, unknown>).api = {
  thread: { read: readMock }
}

import { useThreadStore } from '../thread-store'
import { handleThreadChanged } from '../thread-sync'

const U1: ThreadMessage = { role: 'user', body: 'hi', sentAt: '2026-07-15T10:00:00.000Z' }
const A1: ThreadMessage = { role: 'assistant', body: 'reply', sentAt: '2026-07-15T10:01:00.000Z' }

const rendererThread = (id = 't1'): Thread => ({
  id,
  agent: 'cli-claude',
  model: 'sonnet',
  started: '2026-07-15T09:00:00.000Z',
  lastMessage: U1.sentAt,
  title: 'Renderer title',
  dockState: { tabs: [{ kind: 'canvas', id: 'default' }] },
  messages: [U1]
})

const diskThread = (id = 't1'): Thread => ({
  ...rendererThread(id),
  // Disk metadata deliberately diverges: the refresh must NOT take it.
  title: 'Disk title',
  model: 'opus',
  dockState: { tabs: [] },
  messages: [U1, A1],
  lastMessage: A1.sentAt
})

beforeEach(() => {
  useThreadStore.setState(useThreadStore.getInitialState())
  useThreadStore.setState({ vaultPath: '/ws', threadsById: { t1: rendererThread() } })
  readMock.mockReset()
  readMock.mockResolvedValue(diskThread())
})

describe('handleThreadChanged', () => {
  it('replaces only messages + lastMessage on a matching event; metadata is kept', async () => {
    await handleThreadChanged({ root: '/ws', threadId: 't1' })
    expect(readMock).toHaveBeenCalledExactlyOnceWith('/ws', 't1')
    const t = useThreadStore.getState().threadsById['t1']
    expect(t.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(t.lastMessage).toBe(A1.sentAt)
    // Renderer-held metadata survives: disk can only be equal or older here.
    expect(t.title).toBe('Renderer title')
    expect(t.model).toBe('sonnet')
    expect(t.dockState.tabs).toEqual([{ kind: 'canvas', id: 'default' }])
  })

  it('ignores a foreign-root push without reading disk', async () => {
    await handleThreadChanged({ root: '/other-ws', threadId: 't1' })
    expect(readMock).not.toHaveBeenCalled()
    expect(useThreadStore.getState().threadsById['t1'].messages).toHaveLength(1)
  })

  it('ignores an unknown threadId without reading disk', async () => {
    await handleThreadChanged({ root: '/ws', threadId: 't-unloaded' })
    expect(readMock).not.toHaveBeenCalled()
    expect(useThreadStore.getState().threadsById['t-unloaded']).toBeUndefined()
  })

  it('drops the refresh when the workspace switches between event receipt and read completion', async () => {
    readMock.mockImplementation(async () => {
      // Simulate a workspace switch racing the disk read.
      useThreadStore.setState({ vaultPath: '/switched', threadsById: {} })
      return diskThread()
    })
    await handleThreadChanged({ root: '/ws', threadId: 't1' })
    expect(useThreadStore.getState().threadsById).toEqual({})
  })

  it('ignores a null read (thread deleted between push and read)', async () => {
    readMock.mockResolvedValue(null)
    await handleThreadChanged({ root: '/ws', threadId: 't1' })
    const t = useThreadStore.getState().threadsById['t1']
    expect(t.messages).toHaveLength(1)
    expect(t.lastMessage).toBe(U1.sentAt)
  })
})
