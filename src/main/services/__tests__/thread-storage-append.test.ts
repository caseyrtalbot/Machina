// @vitest-environment node
/**
 * ThreadStorage append entry point + per-thread write serialization (Phase 3
 * step 4, contracts §4 v1.3.3). Main is the single writer of CLI-thread
 * MESSAGES: appendMessage is a queued read-modify-write that never recreates
 * a deleted/archived file, saveThreadFromRenderer never contributes cli messages, and the
 * shared write queue kills the append-vs-archive/delete resurrection race and
 * the append-vs-save interleave. Real fs in mkdtemp vaults.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ThreadStorage } from '../thread-storage'
import { drainThreadWrites } from '../thread-write-queue'
import { TE_DIR, THREADS_DIR } from '../../../shared/constants'
import type { Thread, ThreadMessage } from '../../../shared/thread-types'

let vault: string
let store: ThreadStorage

beforeEach(() => {
  vault = mkdtempSync(path.join(tmpdir(), 'machina-append-'))
  store = new ThreadStorage(vault)
})

afterEach(() => {
  rmSync(vault, { recursive: true, force: true })
})

const U1: ThreadMessage = { role: 'user', body: 'hi', sentAt: '2026-07-15T10:00:00.000Z' }
const A1: ThreadMessage = { role: 'assistant', body: 'reply', sentAt: '2026-07-15T10:01:00.000Z' }

const seed = (id = '2026-07-15-cli'): Thread => ({
  id,
  agent: 'cli-claude',
  model: 'sonnet',
  started: '2026-07-15T09:00:00.000Z',
  lastMessage: U1.sentAt,
  title: 'Seeded',
  dockState: { tabs: [] },
  messages: [U1]
})

function threadFile(id: string): string {
  return path.join(vault, TE_DIR, THREADS_DIR, `${id}.md`)
}

function assistantCount(t: Thread): number {
  return t.messages.filter((m) => m.role === 'assistant').length
}

describe('ThreadStorage.appendMessage', () => {
  it('appends to disk and bumps lastMessage to the message sentAt', async () => {
    const t = seed()
    await store.saveThread(t)
    const appended = await store.appendMessage(t.id, A1)
    expect(appended).toBe(true)
    const read = await store.readThread(t.id)
    expect(read.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(read.messages[1].body).toBe('reply')
    expect(read.lastMessage).toBe(A1.sentAt)
  })

  it('returns false on a missing thread file and never mints one', async () => {
    const appended = await store.appendMessage('2026-07-15-ghost', A1)
    expect(appended).toBe(false)
    expect(existsSync(threadFile('2026-07-15-ghost'))).toBe(false)
  })

  it('deletion wins: append after deleteThread returns false and the thread stays deleted', async () => {
    const t = seed()
    await store.saveThread(t)
    await store.deleteThread(t.id)
    const appended = await store.appendMessage(t.id, A1)
    expect(appended).toBe(false)
    expect(existsSync(threadFile(t.id))).toBe(false)
  })

  it('archive wins: an in-flight append cannot resurrect a live file next to the archive copy', async () => {
    const t = seed()
    await store.saveThread(t)
    // Not awaited before the append: both ride the same per-thread queue, so
    // the rename lands first and the append sees ENOENT — never a duplicate
    // in live + archive.
    const archiving = store.archiveThread(t.id)
    const appending = store.appendMessage(t.id, A1)
    await archiving
    expect(await appending).toBe(false)
    expect(await store.listThreads()).toHaveLength(0)
    expect(await store.listArchived()).toHaveLength(1)
  })

  it('propagates non-ENOENT failures to the caller (the diagnostic boundary)', async () => {
    // A directory squatting on the thread path makes readFile throw EISDIR —
    // exactly the "corrupt/unreadable, not missing" class that must NOT be
    // swallowed into a silent false.
    const id = '2026-07-15-squat'
    mkdirSync(threadFile(id), { recursive: true })
    await expect(store.appendMessage(id, A1)).rejects.toThrow()
  })

  it('serializes with saveThread through the per-thread queue (no interleaved clobber)', async () => {
    const t = seed()
    await store.saveThread(t)
    // Enqueued in this order without awaiting: whole-save, then append. The
    // append's read-modify-write must observe the completed save, so the
    // final file is deterministic: [u1, a1].
    const saving = store.saveThread({ ...t, title: 'Renamed' })
    const appending = store.appendMessage(t.id, A1)
    await Promise.all([saving, appending])
    const read = await store.readThread(t.id)
    expect(read.title).toBe('Renamed')
    expect(read.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
  })
})

describe('ThreadStorage.saveThreadFromRenderer', () => {
  it('persists metadata while messages ALWAYS come from disk', async () => {
    const t = seed()
    await store.saveThread(t)
    await store.appendMessage(t.id, A1)
    // Stale renderer snapshot: old messages array, new metadata.
    await store.saveThreadFromRenderer({
      ...t,
      title: 'Renamed by renderer',
      model: 'opus',
      agentId: 'test-fixer',
      dockState: { tabs: [{ kind: 'canvas', id: 'default' }] },
      messages: [U1]
    })
    const read = await store.readThread(t.id)
    expect(read.title).toBe('Renamed by renderer')
    expect(read.model).toBe('opus')
    expect(read.agentId).toBe('test-fixer')
    expect(read.dockState.tabs).toEqual([{ kind: 'canvas', id: 'default' }])
    // The main-appended assistant reply survived the stale snapshot.
    expect(read.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
  })

  it('takes the later lastMessage of disk and caller', async () => {
    const t = seed()
    await store.saveThread(t)
    await store.appendMessage(t.id, A1)
    // Caller older than disk: disk wins.
    await store.saveThreadFromRenderer({ ...t, lastMessage: U1.sentAt })
    expect((await store.readThread(t.id)).lastMessage).toBe(A1.sentAt)
    // Caller newer than disk: caller wins.
    const later = '2026-07-15T11:00:00.000Z'
    await store.saveThreadFromRenderer({ ...t, lastMessage: later })
    expect((await store.readThread(t.id)).lastMessage).toBe(later)
  })

  it('is a no-op on a missing file — a meta-save never mints a thread', async () => {
    const t = seed('2026-07-15-unminted')
    await store.saveThreadFromRenderer(t)
    expect(existsSync(threadFile(t.id))).toBe(false)
  })

  it('the cli-vs-native branch keys off the ON-DISK agent, not the payload', async () => {
    // Relabel bypass (review hardening): a payload claiming machina-native
    // for an on-disk cli thread must still be treated as a meta-merge, and
    // the agent identity change itself is rejected (immutable after mint).
    const t = seed()
    await store.saveThread(t)
    await store.appendMessage(t.id, A1)
    await store.saveThreadFromRenderer({ ...t, agent: 'machina-native', messages: [U1] })
    const read = await store.readThread(t.id)
    expect(read.agent).toBe('cli-claude')
    expect(read.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
  })
})

describe('drainThreadWrites (coordinated quit, P3 step 4)', () => {
  it('resolves only after every queued (detached) write reached disk', async () => {
    const t = seed()
    await store.saveThread(t)
    // Deliberately not awaited — the onTurnComplete assistant append is
    // fire-and-forget in shell.ts, so quit relies on the drain for it.
    const appending = store.appendMessage(t.id, A1)
    await drainThreadWrites()
    expect((await store.readThread(t.id)).messages).toHaveLength(2)
    await appending
  })
})

describe('exactly-once persistence (append + meta-merge, order-independent)', () => {
  // The spec's named failure mode: main appends the assistant final AND a
  // subscribed renderer saves its own copy of the same reply. Whichever
  // order the two writes land in, the file must hold exactly one assistant
  // message — the meta-merge never contributes messages, the append
  // contributes exactly one.
  const staleDuplicate = (t: Thread): Thread => ({
    ...t,
    messages: [U1, { ...A1, body: 'renderer-built duplicate of the reply' }],
    lastMessage: A1.sentAt
  })

  it('main append first, renderer merge-save second', async () => {
    const t = seed()
    await store.saveThread(t)
    await store.appendMessage(t.id, A1)
    await store.saveThreadFromRenderer(staleDuplicate(t))
    const read = await store.readThread(t.id)
    expect(assistantCount(read)).toBe(1)
    expect(read.messages[1].body).toBe('reply')
  })

  it('renderer merge-save first, main append second', async () => {
    const t = seed()
    await store.saveThread(t)
    await store.saveThreadFromRenderer(staleDuplicate(t))
    await store.appendMessage(t.id, A1)
    const read = await store.readThread(t.id)
    expect(assistantCount(read)).toBe(1)
    expect(read.messages[1].body).toBe('reply')
  })

  it('concurrent (unawaited) append + merge-save still yields exactly one assistant message', async () => {
    const t = seed()
    await store.saveThread(t)
    await Promise.all([
      store.appendMessage(t.id, A1),
      store.saveThreadFromRenderer(staleDuplicate(t))
    ])
    expect(assistantCount(await store.readThread(t.id))).toBe(1)
  })
})
