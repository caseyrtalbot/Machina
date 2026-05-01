// @vitest-environment node
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ThreadStorage } from '../../../src/main/services/thread-storage'

let vault: string

beforeEach(() => {
  vault = mkdtempSync(path.join(tmpdir(), 'mv-'))
})

afterEach(() => {
  rmSync(vault, { recursive: true, force: true })
})

// These mirror the behavior the thread-ipc handlers wrap. The handlers
// themselves are thin pass-throughs; testing them via the storage class
// covers the contract without spinning up an Electron process.
describe('thread-ipc behavior (via storage)', () => {
  it('save + list returns the thread', async () => {
    const store = new ThreadStorage(vault)
    await store.saveThread({
      id: 'a',
      agent: 'machina-native',
      model: 'm',
      started: '2026-05-01T00:00:00Z',
      lastMessage: '2026-05-01T00:00:00Z',
      title: 't',
      dockState: { tabs: [] },
      messages: []
    })
    const list = await store.listThreads()
    expect(list.map((x) => x.id)).toContain('a')
  })

  it('read after save returns equivalent thread', async () => {
    const store = new ThreadStorage(vault)
    await store.saveThread({
      id: 'b',
      agent: 'cli-claude',
      model: 'sonnet',
      started: '2026-05-01T00:00:00Z',
      lastMessage: '2026-05-01T00:01:00Z',
      title: 'Hello',
      dockState: { tabs: [{ kind: 'graph' }] },
      messages: [{ role: 'user', body: 'q', sentAt: '2026-05-01T00:00:00Z' }]
    })
    const back = await store.readThread('b')
    expect(back.title).toBe('Hello')
    expect(back.dockState.tabs).toEqual([{ kind: 'graph' }])
    expect(back.messages).toHaveLength(1)
  })
})
