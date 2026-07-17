// @vitest-environment node
/**
 * Durable cost ledger tests (workstation Phase 3 step 5, contracts v1.3.4).
 * Real filesystem for the persisted mirror; audit injected. Harness copied
 * from harness-run-registry.test.ts (same persistence pattern under test).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AuditEntry } from '@shared/agent-types'
import { AgentCostLedger, type AgentCostLedgerDeps } from '../agent-cost-ledger'

// The module wires a singleton against app.getPath at import time paths;
// tests construct instances with injected deps only.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/unused' } }))

// Real atomicWrite by default; the persist-serialization test swaps in a
// slowed implementation to prove overlapping writes cannot interleave.
const atomicCtl = vi.hoisted(() => ({
  impl: null as null | ((filePath: string, data: string) => Promise<void>)
}))
vi.mock('../../utils/atomic-write', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/atomic-write')>()
  return {
    ...actual,
    atomicWrite: (filePath: string, data: string) =>
      atomicCtl.impl !== null ? atomicCtl.impl(filePath, data) : actual.atomicWrite(filePath, data)
  }
})

const ROOT = '/tmp/ws-a'
const SLUG = 'test-fixer'

let dir: string
let filePath: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-cost-ledger-'))
  filePath = path.join(dir, 'agent-cost-ledger.json')
  atomicCtl.impl = null
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

interface Harness {
  readonly ledger: AgentCostLedger
  readonly auditEntries: AuditEntry[]
}

function makeLedger(overrides: Partial<AgentCostLedgerDeps> = {}): Harness {
  const auditEntries: AuditEntry[] = []
  const ledger = new AgentCostLedger({
    filePath,
    audit: { log: (entry) => auditEntries.push(entry) },
    ...overrides
  })
  return { ledger, auditEntries }
}

describe('monotone accumulation + persistence round-trip', () => {
  it('accumulates spend per (root, slug) and persists it', async () => {
    const h = makeLedger()
    await h.ledger.recordSpend(ROOT, SLUG, 0.49012999999999995)
    await h.ledger.recordSpend(ROOT, SLUG, 0.01)
    expect(h.ledger.spendFor(ROOT, SLUG)).toBeCloseTo(0.50013, 10)

    const persisted = JSON.parse(await fs.readFile(filePath, 'utf8'))
    expect(persisted.version).toBe(1)
    expect(persisted.spend[`${ROOT}\u0000${SLUG}`]).toBeCloseTo(0.50013, 10)
  })

  it('a FRESH instance on the same file resumes the spend — relaunch does not refill money', async () => {
    const first = makeLedger()
    await first.ledger.recordSpend(ROOT, SLUG, 1.25)

    const second = makeLedger()
    await second.ledger.load()
    expect(second.ledger.spendFor(ROOT, SLUG)).toBe(1.25)

    // Accumulation continues on the resumed floor — no reset API exists.
    await second.ledger.recordSpend(ROOT, SLUG, 0.25)
    expect(second.ledger.spendFor(ROOT, SLUG)).toBe(1.5)
  })

  it('spendFor discriminates undefined (never observed) from a number — NEVER 0 for never-seen', async () => {
    const h = makeLedger()
    await h.ledger.load()
    expect(h.ledger.spendFor(ROOT, SLUG)).toBeUndefined()
    await h.ledger.recordSpend(ROOT, SLUG, 0)
    // An observed $0 is a real observation — distinct from never-observed.
    expect(h.ledger.spendFor(ROOT, SLUG)).toBe(0)
    expect(h.ledger.spendFor(ROOT, 'other-slug')).toBeUndefined()
  })

  it('drops non-finite and negative deltas (monotone: money never decrements)', async () => {
    const h = makeLedger()
    await h.ledger.recordSpend(ROOT, SLUG, 1)
    await h.ledger.recordSpend(ROOT, SLUG, -0.5)
    await h.ledger.recordSpend(ROOT, SLUG, Number.NaN)
    await h.ledger.recordSpend(ROOT, SLUG, Number.POSITIVE_INFINITY)
    expect(h.ledger.spendFor(ROOT, SLUG)).toBe(1)
  })

  it('keys never collide across the root/slug boundary (NUL delimiter)', async () => {
    // Under a space delimiter, root '/ws a' + slug 'my-slug' and root '/ws' +
    // slug 'a my-slug' would share one key and alias each other's spend.
    const h = makeLedger()
    await h.ledger.recordSpend('/ws a', 'my-slug', 2)
    expect(h.ledger.spendFor('/ws', 'a my-slug')).toBeUndefined()
    expect(h.ledger.spendFor('/ws a', 'my-slug')).toBe(2)
  })
})

describe('degrade-not-fail mirror decode', () => {
  it('a corrupt mirror loads as empty, never throws, and logs ONE audit entry', async () => {
    await fs.writeFile(filePath, 'not json {{{', 'utf8')
    const h = makeLedger()
    await h.ledger.load()
    expect(h.ledger.spendFor(ROOT, SLUG)).toBeUndefined()
    // Stricter than HarnessRunRegistry's silent degrade (recorded deviation):
    // a corrupt money mirror is a silent budget-refill channel — say so.
    expect(h.auditEntries).toHaveLength(1)
    expect(h.auditEntries[0]).toMatchObject({
      tool: 'agent-cost-ledger:corrupt-mirror',
      decision: 'error'
    })
    // Records fine afterwards.
    await h.ledger.recordSpend(ROOT, SLUG, 0.5)
    expect(h.ledger.spendFor(ROOT, SLUG)).toBe(0.5)
  })

  it('a missing mirror loads as empty with NO audit entry (first run, not corruption)', async () => {
    const h = makeLedger()
    await h.ledger.load()
    expect(h.ledger.spendFor(ROOT, SLUG)).toBeUndefined()
    expect(h.auditEntries).toEqual([])
  })

  it('an unknown version loads as empty with NO audit entry', async () => {
    await fs.writeFile(filePath, JSON.stringify({ version: 2, spend: { x: 1 } }), 'utf8')
    const h = makeLedger()
    await h.ledger.load()
    expect(h.ledger.spendFor(ROOT, SLUG)).toBeUndefined()
    expect(h.auditEntries).toEqual([])
  })

  it('a non-ENOENT read failure audits ONCE before degrading — never a silent floor reset (v1.3.4 review fix)', async () => {
    // A mirror that EXISTS but cannot be read (EACCES, EISDIR, I/O error) is
    // not a first run: swallowing it silently would reset the observed-spend
    // floor, and the next recordSpend would durably overwrite the file
    // (atomicWrite renames over the unreadable target). EISDIR keeps the
    // repro portable (chmod 000 is a no-op when tests run as root).
    await fs.mkdir(filePath)
    const h = makeLedger()
    await h.ledger.load()
    expect(h.ledger.spendFor(ROOT, SLUG)).toBeUndefined()
    expect(h.auditEntries).toHaveLength(1)
    expect(h.auditEntries[0]).toMatchObject({
      tool: 'agent-cost-ledger:corrupt-mirror',
      decision: 'error'
    })
  })

  it('a current-version file with a non-object spend field audits ONCE (structural corruption)', async () => {
    await fs.writeFile(filePath, JSON.stringify({ version: 1, spend: 'garbled' }), 'utf8')
    const h = makeLedger()
    await h.ledger.load()
    expect(h.ledger.spendFor(ROOT, SLUG)).toBeUndefined()
    expect(h.auditEntries).toHaveLength(1)
    expect(h.auditEntries[0]).toMatchObject({
      tool: 'agent-cost-ledger:corrupt-mirror',
      decision: 'error'
    })
  })

  it('decode is per-entry-tolerant: one bad value never rejects the file', async () => {
    await fs.writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        spend: {
          [`${ROOT}\u0000${SLUG}`]: 1.5,
          [`${ROOT}\u0000negative`]: -3,
          [`${ROOT}\u0000stringy`]: 'lots',
          [`${ROOT}\u0000nully`]: null
        }
      }),
      'utf8'
    )
    const h = makeLedger()
    await h.ledger.load()
    expect(h.ledger.spendFor(ROOT, SLUG)).toBe(1.5)
    expect(h.ledger.spendFor(ROOT, 'negative')).toBeUndefined()
    expect(h.ledger.spendFor(ROOT, 'stringy')).toBeUndefined()
    expect(h.ledger.spendFor(ROOT, 'nully')).toBeUndefined()
    expect(h.auditEntries).toEqual([])
  })
})

describe('serialized persist chain + flush', () => {
  it('serializes concurrent persists — the final mirror carries the latest full state', async () => {
    const payloads: string[] = []
    let active = 0
    let overlapped = false
    atomicCtl.impl = async (_fp, data) => {
      active += 1
      if (active > 1) overlapped = true
      // The first write is artificially slow: an unserialized overlap would
      // let its stale snapshot's rename land last and drop spend.
      await new Promise((resolve) => setTimeout(resolve, payloads.length === 0 ? 25 : 0))
      payloads.push(data)
      active -= 1
    }
    const h = makeLedger()
    await Promise.all([
      h.ledger.recordSpend(ROOT, 'slug-a', 1),
      h.ledger.recordSpend(ROOT, 'slug-b', 2)
    ])
    expect(overlapped).toBe(false)
    const last = JSON.parse(payloads[payloads.length - 1])
    expect(Object.keys(last.spend)).toHaveLength(2)
  })

  it('a failed write rejects its caller but never poisons later persists', async () => {
    atomicCtl.impl = async () => {
      throw new Error('ENOSPC')
    }
    const h = makeLedger()
    await expect(h.ledger.recordSpend(ROOT, SLUG, 1)).rejects.toThrow('ENOSPC')

    atomicCtl.impl = null
    await h.ledger.recordSpend(ROOT, SLUG, 0.5)
    // In-memory floor kept both increments; the mirror carries the full state.
    expect(h.ledger.spendFor(ROOT, SLUG)).toBe(1.5)
    const persisted = JSON.parse(await fs.readFile(filePath, 'utf8'))
    expect(persisted.spend[`${ROOT}\u0000${SLUG}`]).toBe(1.5)
  })

  it('flush() resolves after chained persists land (coordinated-quit surface)', async () => {
    let writes = 0
    atomicCtl.impl = async (fp, data) => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      writes += 1
      await fs.writeFile(fp, data, 'utf8')
    }
    const h = makeLedger()
    // Detached record (the shell.ts wiring is fire-and-forget): flush must
    // still wait for its persist.
    const pending = h.ledger.recordSpend(ROOT, SLUG, 0.75)
    await h.ledger.flush()
    expect(writes).toBe(1)
    await pending
    const persisted = JSON.parse(await fs.readFile(filePath, 'utf8'))
    expect(persisted.spend[`${ROOT}\u0000${SLUG}`]).toBe(0.75)
  })
})
