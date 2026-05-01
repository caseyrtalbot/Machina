// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ThreadStorage } from '../../../src/main/services/thread-storage'
import type { Thread } from '../../../src/shared/thread-types'

let vault: string
let store: ThreadStorage

beforeEach(() => {
  vault = mkdtempSync(path.join(tmpdir(), 'machina-vault-'))
  store = new ThreadStorage(vault)
})

afterEach(() => {
  rmSync(vault, { recursive: true, force: true })
})

const sample = (id = '2026-05-01-a'): Thread => ({
  id,
  agent: 'machina-native',
  model: 'claude-sonnet-4-6',
  started: '2026-05-01T13:00:00Z',
  lastMessage: '2026-05-01T13:00:00Z',
  title: 'Sample',
  dockState: { tabs: [] },
  messages: [{ role: 'user', body: 'hi', sentAt: '2026-05-01T13:00:00Z' }]
})

describe('ThreadStorage', () => {
  it('creates and reads a thread', async () => {
    const t = sample()
    await store.saveThread(t)
    const read = await store.readThread(t.id)
    expect(read.title).toBe('Sample')
    expect(read.id).toBe(t.id)
  })

  it('lists threads in last-message-desc order', async () => {
    await store.saveThread({ ...sample('2026-05-01-a'), lastMessage: '2026-05-01T13:00:00Z' })
    await store.saveThread({ ...sample('2026-05-01-b'), lastMessage: '2026-05-01T13:05:00Z' })
    const list = await store.listThreads()
    expect(list.map((t) => t.id)).toEqual(['2026-05-01-b', '2026-05-01-a'])
  })

  it('archives a thread (moves the file under year)', async () => {
    const t = sample()
    await store.saveThread(t)
    await store.archiveThread(t.id)
    const list = await store.listThreads()
    expect(list).toHaveLength(0)
    const archived = await store.listArchived()
    expect(archived).toHaveLength(1)
    expect(archived[0].id).toBe(t.id)
  })

  it('unarchives a thread back to active', async () => {
    const t = sample()
    await store.saveThread(t)
    await store.archiveThread(t.id)
    await store.unarchiveThread(t.id)
    const list = await store.listThreads()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(t.id)
  })

  it('deletes a thread', async () => {
    const t = sample()
    await store.saveThread(t)
    await store.deleteThread(t.id)
    const list = await store.listThreads()
    expect(list).toHaveLength(0)
  })

  it('readConfig returns defaults for new vault', async () => {
    const cfg = await store.readConfig()
    expect(cfg.defaultAgent).toBe('machina-native')
    expect(cfg.welcomed).toBe(false)
  })

  it('writeConfig persists', async () => {
    await store.writeConfig({
      defaultAgent: 'cli-claude',
      defaultModel: 'sonnet',
      welcomed: true,
      customKeybindings: {}
    })
    const cfg = await store.readConfig()
    expect(cfg.defaultAgent).toBe('cli-claude')
    expect(cfg.welcomed).toBe(true)
  })
})
