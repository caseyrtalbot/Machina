// @vitest-environment node
/**
 * Disk mirror for the approval queue (workstation Phase 3 step 1, contracts
 * §4 v1.3.0): versioned shape, serialized atomic writes, degrade-not-fail
 * load, and the gate-confirm-never-serialized rule enforced at both ends.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { ApprovalQueuePersistence } from '../../src/main/services/approval-queue-persistence'
import type { PendingChange } from '../../src/shared/git-types'

const NO_FLAGS = {
  highVelocity: false,
  headMoved: false,
  concurrentTurns: false,
  degradedAttribution: false,
  gateDegraded: false,
  attributionSuspect: false,
  forbidden: false
} as const

function cliChange(overrides: Partial<PendingChange> = {}): PendingChange {
  return {
    id: 'pc_t1',
    kind: 'cli-change',
    threadId: 'th-1',
    agentId: 'fixer',
    paths: ['a.txt'],
    diff: 'diff-v1',
    capturedAt: '2026-07-14T00:00:00.000Z',
    revertible: true,
    flags: NO_FLAGS,
    capturedRoot: '/workspace',
    ...overrides
  }
}

let dir: string
let filePath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'machina-queue-mirror-'))
  filePath = join(dir, 'approval-queue.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('ApprovalQueuePersistence round-trip', () => {
  it('persists and reloads cli-change items byte-faithfully', async () => {
    const p = new ApprovalQueuePersistence(filePath)
    const items = [
      cliChange(),
      cliChange({
        id: 'pc_t2',
        paths: ['b.txt', 'c/d.txt'],
        flags: { ...NO_FLAGS, headMoved: true },
        description: 'two files',
        capturedRoot: '/other-root'
      })
    ]

    await p.persist(items)
    const loaded = await new ApprovalQueuePersistence(filePath).load()

    expect(loaded.items).toEqual(items)
    expect(loaded.dropped).toEqual([])
  })

  it('an item captured with a null root round-trips as capturedRoot null', async () => {
    const p = new ApprovalQueuePersistence(filePath)
    await p.persist([cliChange({ capturedRoot: null })])
    const { items } = await p.load()
    expect(items[0]?.capturedRoot).toBeNull()
  })

  it('sequential persists: the last snapshot wins', async () => {
    const p = new ApprovalQueuePersistence(filePath)
    const first = p.persist([cliChange()])
    const second = p.persist([cliChange(), cliChange({ id: 'pc_t2' })])
    const third = p.persist([cliChange({ id: 'pc_t2' })])
    await Promise.all([first, second, third])

    const { items } = await p.load()
    expect(items.map((i) => i.id)).toEqual(['pc_t2'])
  })
})

describe('ApprovalQueuePersistence gate-confirm exclusion (never serialized)', () => {
  it('filters gate-confirm items out at persist time', async () => {
    const p = new ApprovalQueuePersistence(filePath)
    const confirm = cliChange({ id: 'gc_1', kind: 'gate-confirm' })
    await p.persist([confirm, cliChange()])

    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as { items: PendingChange[] }
    expect(raw.items.map((i) => i.id)).toEqual(['pc_t1'])
  })

  it('refuses a gate-confirm smuggled into the mirror at load time', async () => {
    writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        items: [cliChange({ id: 'gc_9', kind: 'gate-confirm' }), cliChange()]
      })
    )
    const { items, dropped } = await new ApprovalQueuePersistence(filePath).load()
    expect(items.map((i) => i.id)).toEqual(['pc_t1'])
    // The refusal is REPORTED, never silent (contracts §4 v1.3.0): the
    // caller audits it as an approvals:rehydrate-drop.
    expect(dropped).toEqual([{ id: 'gc_9', reason: 'gate-confirm-never-rehydrated' }])
  })
})

describe('ApprovalQueuePersistence degrade-not-fail load', () => {
  it('missing file loads as empty with no drop diagnostics (normal first run)', async () => {
    const loaded = await new ApprovalQueuePersistence(filePath).load()
    expect(loaded).toEqual({ items: [], dropped: [] })
  })

  it('corrupt JSON loads as empty', async () => {
    writeFileSync(filePath, '{ not json !!!')
    const loaded = await new ApprovalQueuePersistence(filePath).load()
    expect(loaded).toEqual({ items: [], dropped: [] })
  })

  it('unknown version loads as empty', async () => {
    writeFileSync(filePath, JSON.stringify({ version: 2, items: [cliChange()] }))
    const loaded = await new ApprovalQueuePersistence(filePath).load()
    expect(loaded).toEqual({ items: [], dropped: [] })
  })

  it('per-item tolerance: a malformed entry is dropped WITH a diagnostic, valid siblings survive', async () => {
    writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        items: [
          { id: 'pc_bad', kind: 'cli-change' }, // missing everything else
          cliChange({ id: 'pc_bad_flags', flags: { headMoved: 'yes' } as never }),
          cliChange({ id: 'pc_good' }),
          'not-an-object'
        ]
      })
    )
    const { items, dropped } = await new ApprovalQueuePersistence(filePath).load()
    expect(items.map((i) => i.id)).toEqual(['pc_good'])
    expect(dropped).toEqual([
      { id: 'pc_bad', reason: 'malformed' },
      { id: 'pc_bad_flags', reason: 'malformed' },
      { id: 'unknown', reason: 'malformed' }
    ])
  })

  it('a missing capturedRoot decodes as null (the queue drops it conservatively)', async () => {
    const item = cliChange()
    const { capturedRoot: _dropped, ...withoutRoot } = item
    writeFileSync(filePath, JSON.stringify({ version: 1, items: [withoutRoot] }))
    const { items } = await new ApprovalQueuePersistence(filePath).load()
    expect(items[0]?.capturedRoot).toBeNull()
  })
})
