// @vitest-environment node
/**
 * 'thread:save' persistence-authority cutover (Phase 3 step 4, contracts §4
 * v1.3.3): for CLI-agent threads the handler is a metadata merge — the
 * renderer structurally cannot write messages, so a stale in-memory snapshot
 * can neither double-append nor clobber a main-appended reply. Native-agent
 * saves stay whole-saves, bit-for-bit. Real ThreadStorage on mkdtemp vaults;
 * only the typed-ipc boundary is captured.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Thread, ThreadMessage } from '../../../shared/thread-types'
import { TE_DIR, THREADS_DIR } from '../../../shared/constants'

const state = vi.hoisted(() => ({
  handlers: new Map<string, (args: never) => unknown>(),
  sends: [] as Array<{ event: string; data: unknown }>,
  mainWindow: {} as unknown
}))

vi.mock('../../typed-ipc', () => ({
  typedHandle: vi.fn((channel: string, handler: (args: never) => unknown) => {
    state.handlers.set(channel, handler)
  }),
  typedSend: vi.fn((_window: unknown, event: string, data: unknown) => {
    state.sends.push({ event, data })
  })
}))

vi.mock('../../window-registry', () => ({
  getMainWindow: vi.fn(() => state.mainWindow)
}))

import { registerThreadIpc } from '../thread-ipc'
import { ThreadStorage } from '../../services/thread-storage'

function invoke<T>(channel: string, args: unknown): Promise<T> {
  const handler = state.handlers.get(channel)
  if (!handler) throw new Error(`handler not registered: ${channel}`)
  return Promise.resolve(handler(args as never)) as Promise<T>
}

const U1: ThreadMessage = { role: 'user', body: 'hi', sentAt: '2026-07-15T10:00:00.000Z' }
const A1: ThreadMessage = { role: 'assistant', body: 'reply', sentAt: '2026-07-15T10:01:00.000Z' }

const cliThread = (id = '2026-07-15-cli'): Thread => ({
  id,
  agent: 'cli-claude',
  model: 'sonnet',
  started: '2026-07-15T09:00:00.000Z',
  lastMessage: U1.sentAt,
  title: 'CLI thread',
  dockState: { tabs: [] },
  messages: [U1]
})

const nativeThread = (id = '2026-07-15-native'): Thread => ({
  ...cliThread(id),
  agent: 'machina-native',
  title: 'Native thread'
})

let vault: string
let storage: ThreadStorage

beforeEach(() => {
  state.handlers.clear()
  state.sends.length = 0
  state.mainWindow = {}
  vi.clearAllMocks()
  registerThreadIpc()
  vault = mkdtempSync(path.join(tmpdir(), 'machina-merge-'))
  storage = new ThreadStorage(vault)
})

afterEach(() => {
  rmSync(vault, { recursive: true, force: true })
})

describe("'thread:save' meta-merge for cli threads (exactly-once cutover)", () => {
  it('a stale renderer snapshot cannot clobber a main-appended reply (save after append)', async () => {
    const t = cliThread()
    await storage.saveThread(t)
    await storage.appendMessage(t.id, A1)
    // The renderer's whole-thread payload still carries only [u1] — the
    // pre-cutover read-modify-write clobber. The merge must keep disk.
    await invoke('thread:save', { vaultPath: vault, thread: { ...t, title: 'Renamed' } })
    const read = await storage.readThread(t.id)
    expect(read.title).toBe('Renamed')
    expect(read.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(read.lastMessage).toBe(A1.sentAt)
  })

  it('a renderer snapshot carrying its own copy of the reply cannot double-append (save before append)', async () => {
    const t = cliThread()
    await storage.saveThread(t)
    // Renderer finalize built its own assistant message for the same turn.
    await invoke('thread:save', {
      vaultPath: vault,
      thread: { ...t, messages: [U1, { ...A1, body: 'renderer duplicate' }] }
    })
    await storage.appendMessage(t.id, A1)
    const read = await storage.readThread(t.id)
    expect(read.messages.filter((m) => m.role === 'assistant')).toHaveLength(1)
    expect(read.messages[1].body).toBe('reply')
  })

  it('persists cli-thread metadata (title/model/agentId/dockState) through the merge', async () => {
    const t = cliThread()
    await storage.saveThread(t)
    await invoke('thread:save', {
      vaultPath: vault,
      thread: {
        ...t,
        title: 'New title',
        model: 'opus',
        agentId: 'test-fixer',
        dockState: { tabs: [{ kind: 'canvas', id: 'default' }] }
      }
    })
    const read = await storage.readThread(t.id)
    expect(read.title).toBe('New title')
    expect(read.model).toBe('opus')
    expect(read.agentId).toBe('test-fixer')
    expect(read.dockState.tabs).toEqual([{ kind: 'canvas', id: 'default' }])
  })

  it('a cli meta-merge on a missing file is a no-op (never mints a thread)', async () => {
    const t = cliThread('2026-07-15-missing')
    await invoke('thread:save', { vaultPath: vault, thread: t })
    expect(existsSync(path.join(vault, TE_DIR, THREADS_DIR, `${t.id}.md`))).toBe(false)
  })

  it('native-agent threads remain whole-saves: the payload messages land as-is', async () => {
    const t = nativeThread()
    await storage.saveThread(t)
    await invoke('thread:save', {
      vaultPath: vault,
      thread: { ...t, messages: [U1, A1], lastMessage: A1.sentAt }
    })
    const read = await storage.readThread(t.id)
    expect(read.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(read.lastMessage).toBe(A1.sentAt)
  })

  it('a native whole-save can still mint a file (unchanged pre-cutover behavior)', async () => {
    const t = nativeThread('2026-07-15-native-new')
    await invoke('thread:save', { vaultPath: vault, thread: t })
    const read = await storage.readThread(t.id)
    expect(read.title).toBe('Native thread')
  })
})

describe("'thread:save' authority comes from DISK, never the payload agent (review hardening)", () => {
  it('relabeling a cli thread as machina-native does NOT buy back the whole-save clobber', async () => {
    const t = cliThread()
    await storage.saveThread(t)
    await storage.appendMessage(t.id, A1)
    // The bypass the runtime-unvalidated IPC payload invites: same thread,
    // payload agent flipped to native, stale messages array.
    await invoke('thread:save', {
      vaultPath: vault,
      thread: { ...t, agent: 'machina-native', messages: [U1], title: 'Relabeled' }
    })
    const read = await storage.readThread(t.id)
    // Meta-merge semantics held (disk is the authority) AND the identity
    // change was rejected — the thread stays cli on disk.
    expect(read.agent).toBe('cli-claude')
    expect(read.title).toBe('Relabeled')
    expect(read.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
  })

  it('relabeling a native thread as cli is rejected too (agent immutable after mint)', async () => {
    const t = nativeThread()
    await storage.saveThread(t)
    await invoke('thread:save', {
      vaultPath: vault,
      thread: { ...t, agent: 'cli-claude', messages: [U1, A1], lastMessage: A1.sentAt }
    })
    const read = await storage.readThread(t.id)
    expect(read.agent).toBe('machina-native')
    // Still a whole-save: disk authority is native.
    expect(read.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
  })
})

describe("'thread:append-system' (main-owned status-message persistence)", () => {
  it('appends a main-minted system message and pushes thread:changed', async () => {
    const t = cliThread()
    await storage.saveThread(t)
    const result = await invoke<{ ok: boolean }>('thread:append-system', {
      vaultPath: vault,
      threadId: t.id,
      body: 'Message not delivered: the send was refused.'
    })
    expect(result).toEqual({ ok: true })
    const read = await storage.readThread(t.id)
    const last = read.messages[read.messages.length - 1]
    expect(last.role).toBe('system')
    expect(last.body).toBe('Message not delivered: the send was refused.')
    expect(read.lastMessage).toBe(last.sentAt)
    expect(state.sends).toEqual([
      { event: 'thread:changed', data: { root: vault, threadId: t.id } }
    ])
  })

  it('a missing thread file returns ok:false, mints nothing, emits nothing', async () => {
    const result = await invoke<{ ok: boolean }>('thread:append-system', {
      vaultPath: vault,
      threadId: '2026-07-15-gone',
      body: 'status'
    })
    expect(result).toEqual({ ok: false })
    expect(existsSync(path.join(vault, TE_DIR, THREADS_DIR, '2026-07-15-gone.md'))).toBe(false)
    expect(state.sends).toEqual([])
  })

  it('survives a refresh: the status message is on disk, not renderer-memory-only', async () => {
    // The regression this channel closes: refused/indeterminate/start-status
    // system messages used to ride thread:save, whose cli meta-merge drops
    // messages — they vanished on reload ("neither writer").
    const t = cliThread()
    await storage.saveThread(t)
    await invoke('thread:append-system', { vaultPath: vault, threadId: t.id, body: 'start failed' })
    // A later stale renderer meta-save must not erase it either.
    await invoke('thread:save', { vaultPath: vault, thread: { ...t, messages: [U1] } })
    const read = await invoke<Thread | null>('thread:read', { vaultPath: vault, id: t.id })
    expect(read?.messages.map((m) => m.role)).toEqual(['user', 'system'])
  })
})

describe("'thread:read' (the thread:changed refresh read path)", () => {
  it('returns the on-disk thread', async () => {
    const t = cliThread()
    await storage.saveThread(t)
    const read = await invoke<Thread | null>('thread:read', { vaultPath: vault, id: t.id })
    expect(read?.id).toBe(t.id)
    expect(read?.messages).toHaveLength(1)
  })

  it('returns null for a missing thread instead of throwing', async () => {
    const read = await invoke<Thread | null>('thread:read', {
      vaultPath: vault,
      id: '2026-07-15-nope'
    })
    expect(read).toBeNull()
  })
})
