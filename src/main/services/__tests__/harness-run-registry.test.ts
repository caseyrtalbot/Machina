// @vitest-environment node
/**
 * Write-once binding registry tests (workstation step 3, contracts §4
 * v1.2.2). Real filesystem for the persisted mirror; audit and thread/harness
 * probes injected.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AuditEntry } from '@shared/agent-types'
import { TE_DIR, THREADS_DIR } from '@shared/constants'
import {
  HarnessRunRegistry,
  listThreadAgentIdsTolerant,
  type HarnessRunRegistryDeps
} from '../harness-run-registry'

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

let dir: string
let filePath: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-run-registry-'))
  filePath = path.join(dir, 'harness-bindings.json')
  atomicCtl.impl = null
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

interface Harness {
  readonly registry: HarnessRunRegistry
  readonly auditEntries: AuditEntry[]
  readonly listCalls: string[]
}

function makeRegistry(overrides: Partial<HarnessRunRegistryDeps> = {}): Harness {
  const auditEntries: AuditEntry[] = []
  const listCalls: string[] = []
  const registry = new HarnessRunRegistry({
    filePath,
    audit: { log: (entry) => auditEntries.push(entry) },
    listThreadAgentIds: async (root) => {
      listCalls.push(root)
      return []
    },
    harnessDirExists: async () => false,
    ...overrides
  })
  return { registry, auditEntries, listCalls }
}

describe('record (write-once)', () => {
  it('records a binding, is idempotent for the same slug, and refuses a different slug', async () => {
    const h = makeRegistry()
    expect(await h.registry.record(ROOT, 'th1', 'test-fixer')).toEqual({ ok: true })
    expect(h.registry.get(ROOT, 'th1')).toEqual({ slug: 'test-fixer', workspaceRoot: ROOT })

    expect(await h.registry.record(ROOT, 'th1', 'test-fixer')).toEqual({ ok: true })

    const conflict = await h.registry.record(ROOT, 'th1', 'other-harness')
    expect(conflict.ok).toBe(false)
    if (!conflict.ok) expect(conflict.error).toContain('write-once')
    // The original binding survives the refused overwrite.
    expect(h.registry.get(ROOT, 'th1')).toEqual({ slug: 'test-fixer', workspaceRoot: ROOT })
  })

  it('keys bindings by workspace root AND threadId', async () => {
    const h = makeRegistry()
    await h.registry.record(ROOT, 'th1', 'test-fixer')
    expect(h.registry.get('/tmp/ws-b', 'th1')).toBeUndefined()
    expect(await h.registry.record('/tmp/ws-b', 'th1', 'other-harness')).toEqual({ ok: true })
  })

  it('keys never collide across the root/threadId boundary (NUL delimiter)', async () => {
    // Under a space delimiter, root '/ws a' + thread 'th1' and root '/ws' +
    // thread 'a th1' would share one key — a forged pair could alias or
    // block a legitimate binding.
    const h = makeRegistry()
    await h.registry.record('/ws a', 'th1', 'slug-a')
    expect(h.registry.get('/ws', 'a th1')).toBeUndefined()
  })

  it('serializes concurrent persists — the final mirror carries the latest full state', async () => {
    const payloads: string[] = []
    let active = 0
    let overlapped = false
    atomicCtl.impl = async (_fp, data) => {
      active += 1
      if (active > 1) overlapped = true
      // The first write is artificially slow: an unserialized overlap would
      // let its stale snapshot's rename land last and drop a binding.
      await new Promise((resolve) => setTimeout(resolve, payloads.length === 0 ? 25 : 0))
      payloads.push(data)
      active -= 1
    }
    const h = makeRegistry()
    await Promise.all([
      h.registry.record(ROOT, 'th1', 'slug-a'),
      h.registry.record(ROOT, 'th2', 'slug-b')
    ])
    expect(overlapped).toBe(false)
    const last = JSON.parse(payloads[payloads.length - 1])
    expect(Object.keys(last.bindings)).toHaveLength(2)
  })
})

describe('persisted mirror', () => {
  it('a binding survives reload from disk (new instance, same file), write-once included', async () => {
    const first = makeRegistry()
    await first.registry.record(ROOT, 'th1', 'test-fixer')

    const second = makeRegistry()
    await second.registry.ensureRootReady(ROOT)
    expect(second.registry.get(ROOT, 'th1')).toEqual({ slug: 'test-fixer', workspaceRoot: ROOT })

    const conflict = await second.registry.record(ROOT, 'th1', 'other-harness')
    expect(conflict.ok).toBe(false)
  })

  it('a corrupt mirror loads as empty state and records fine afterwards', async () => {
    await fs.writeFile(filePath, 'not json {{{', 'utf8')
    const h = makeRegistry()
    await h.registry.ensureRootReady(ROOT)
    expect(h.registry.get(ROOT, 'th1')).toBeUndefined()
    expect(await h.registry.record(ROOT, 'th1', 'test-fixer')).toEqual({ ok: true })
  })

  it('a missing mirror loads as empty state', async () => {
    const h = makeRegistry()
    await h.registry.ensureRootReady(ROOT)
    expect(h.registry.get(ROOT, 'th1')).toBeUndefined()
  })

  it('an unknown version loads as empty state', async () => {
    await fs.writeFile(
      filePath,
      JSON.stringify({ version: 2, backfilledRoots: [ROOT], bindings: {} }),
      'utf8'
    )
    const h = makeRegistry({
      listThreadAgentIds: async (root) => {
        h.listCalls.push(root)
        return []
      }
    })
    await h.registry.ensureRootReady(ROOT)
    // The unreadable mark was dropped: the root backfills fresh.
    expect(h.listCalls).toEqual([ROOT])
  })
})

describe('ensureRootReady (one-time trust-on-upgrade backfill)', () => {
  it('backfills threads whose agentId is a valid slug naming a real harness dir, with an audit entry each', async () => {
    const h = makeRegistry({
      listThreadAgentIds: async () => [
        { threadId: 'th1', agentId: 'test-fixer' },
        { threadId: 'th2', agentId: 'Not.A.Slug' },
        { threadId: 'th3', agentId: 'ghost-harness' },
        { threadId: 'th4' }
      ],
      harnessDirExists: async (_root, slug) => slug === 'test-fixer'
    })
    await h.registry.ensureRootReady(ROOT)

    expect(h.registry.get(ROOT, 'th1')).toEqual({ slug: 'test-fixer', workspaceRoot: ROOT })
    // Malformed, dirless, and absent agentIds get NO binding — they will
    // degrade + flag on their next send.
    expect(h.registry.get(ROOT, 'th2')).toBeUndefined()
    expect(h.registry.get(ROOT, 'th3')).toBeUndefined()
    expect(h.registry.get(ROOT, 'th4')).toBeUndefined()

    expect(h.auditEntries).toHaveLength(1)
    expect(h.auditEntries[0]).toMatchObject({
      tool: 'cli-agent:binding-backfill',
      args: { threadId: 'th1', slug: 'test-fixer', root: ROOT },
      decision: 'allowed'
    })
  })

  it('runs ONCE per root: a second call is a no-op even for newly tampered threads', async () => {
    let threads: { threadId: string; agentId?: string }[] = []
    const h = makeRegistry({
      listThreadAgentIds: async (root) => {
        h.listCalls.push(root)
        return threads
      },
      harnessDirExists: async () => true
    })
    await h.registry.ensureRootReady(ROOT)
    expect(h.listCalls).toEqual([ROOT])

    threads = [{ threadId: 'th-tampered', agentId: 'test-fixer' }]
    await h.registry.ensureRootReady(ROOT)
    expect(h.listCalls).toEqual([ROOT])
    expect(h.registry.get(ROOT, 'th-tampered')).toBeUndefined()
  })

  it('the backfilled mark persists: a relaunch (new instance) never re-scans', async () => {
    const first = makeRegistry()
    await first.registry.ensureRootReady(ROOT)
    expect(first.listCalls).toEqual([ROOT])

    const second = makeRegistry({
      listThreadAgentIds: async (root) => {
        second.listCalls.push(root)
        return [{ threadId: 'th-tampered', agentId: 'test-fixer' }]
      },
      harnessDirExists: async () => true
    })
    await second.registry.ensureRootReady(ROOT)
    expect(second.listCalls).toEqual([])
    expect(second.registry.get(ROOT, 'th-tampered')).toBeUndefined()
  })

  it('marks a zero-thread root backfilled (and persists the mark)', async () => {
    const h = makeRegistry()
    await h.registry.ensureRootReady(ROOT)
    const persisted = JSON.parse(await fs.readFile(filePath, 'utf8'))
    expect(persisted.backfilledRoots).toContain(ROOT)
  })

  it('memoizes the in-flight backfill so concurrent spawn+input do not double-run', async () => {
    const h = makeRegistry({
      listThreadAgentIds: async (root) => {
        h.listCalls.push(root)
        return [{ threadId: 'th1', agentId: 'test-fixer' }]
      },
      harnessDirExists: async () => true
    })
    await Promise.all([h.registry.ensureRootReady(ROOT), h.registry.ensureRootReady(ROOT)])
    expect(h.listCalls).toEqual([ROOT])
    expect(h.auditEntries).toHaveLength(1)
  })

  it('never overwrites a binding recorded before the scan (write-once holds through backfill)', async () => {
    const h = makeRegistry({
      listThreadAgentIds: async () => [{ threadId: 'th1', agentId: 'frontmatter-slug' }],
      harnessDirExists: async () => true
    })
    await h.registry.record(ROOT, 'th1', 'real-slug')
    await h.registry.ensureRootReady(ROOT)
    expect(h.registry.get(ROOT, 'th1')).toEqual({ slug: 'real-slug', workspaceRoot: ROOT })
    expect(h.auditEntries).toHaveLength(0)
  })

  it('never backfills an adapter-identity-colliding agentId, even with a matching dir', async () => {
    const h = makeRegistry({
      listThreadAgentIds: async () => [{ threadId: 'th1', agentId: 'cli-claude' }],
      harnessDirExists: async () => true
    })
    await h.registry.ensureRootReady(ROOT)
    expect(h.registry.get(ROOT, 'th1')).toBeUndefined()
    expect(h.auditEntries).toHaveLength(0)
  })
})

describe('listThreadAgentIdsTolerant (the production backfill scan)', () => {
  it('skips crafted or corrupt files instead of rejecting the whole scan', async () => {
    // The threads dir is the watcher-ignored tamper channel: one bad file
    // must not turn into a permanent degrade (or worse, a rejected turn).
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tolerant-scan-'))
    const threadsDir = path.join(root, TE_DIR, THREADS_DIR)
    await fs.mkdir(threadsDir, { recursive: true })
    await fs.writeFile(
      path.join(threadsDir, 'th-good.md'),
      '---\nagent: cli-claude\nagent_id: test-fixer\ntitle: fixture\n---\n',
      'utf8'
    )
    // Unsafe basename (uppercase) — readThread refuses the id.
    await fs.writeFile(path.join(threadsDir, 'Notes.md'), 'not a thread', 'utf8')
    // Malformed YAML frontmatter — gray-matter throws.
    await fs.writeFile(
      path.join(threadsDir, 'th-broken.md'),
      '---\nagent: [unclosed\n---\n',
      'utf8'
    )

    const scanned = await listThreadAgentIdsTolerant(root)
    expect(scanned).toEqual([{ threadId: 'th-good', agentId: 'test-fixer' }])
    await fs.rm(root, { recursive: true, force: true })
  })

  it('a missing threads dir scans as empty', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tolerant-scan-empty-'))
    expect(await listThreadAgentIdsTolerant(root)).toEqual([])
    await fs.rm(root, { recursive: true, force: true })
  })
})

// ── Step 6 (contracts §5 v1.2.6): budgets snapshot at bind ──

describe('budgets snapshot at bind (step 6)', () => {
  const BUDGETS = { maxTurns: 5, maxWritesPerMinute: 7 }

  it('records the bind-time budgets snapshot and persists it across a reload', async () => {
    const h = makeRegistry()
    expect(await h.registry.record(ROOT, 'th1', 'test-fixer', BUDGETS)).toEqual({ ok: true })
    expect(h.registry.get(ROOT, 'th1')).toEqual({
      slug: 'test-fixer',
      workspaceRoot: ROOT,
      budgets: BUDGETS
    })

    // Fresh instance over the same mirror file: the snapshot survives.
    const reloaded = makeRegistry()
    await reloaded.registry.ensureRootReady(ROOT)
    expect(reloaded.registry.get(ROOT, 'th1')?.budgets).toEqual(BUDGETS)
  })

  it('a snapshot carrying the step-5 aggregate fields survives persist/reload intact', async () => {
    const AGGREGATE = {
      maxTurns: 5,
      maxWritesPerMinute: 7,
      maxTurnsPerSlug: 50,
      maxWritesPerMinutePerSlug: 30
    }
    const h = makeRegistry()
    expect(await h.registry.record(ROOT, 'th-agg', 'test-fixer', AGGREGATE)).toEqual({ ok: true })
    const reloaded = makeRegistry()
    await reloaded.registry.ensureRootReady(ROOT)
    expect(reloaded.registry.get(ROOT, 'th-agg')?.budgets).toEqual(AGGREGATE)
  })

  it('a same-slug re-record NEVER refreshes the snapshot (snapshot-at-BIND, write-once)', async () => {
    const h = makeRegistry()
    await h.registry.record(ROOT, 'th1', 'test-fixer', BUDGETS)
    // Post-bind SKILL.md edit → a later run request carries new numbers; the
    // running thread keeps its bind-time snapshot (edits affect the NEXT run).
    expect(
      await h.registry.record(ROOT, 'th1', 'test-fixer', { maxTurns: 99, maxWritesPerMinute: 99 })
    ).toEqual({ ok: true })
    expect(h.registry.get(ROOT, 'th1')?.budgets).toEqual(BUDGETS)
  })

  it('a binding without budgets (pre-step-6, backfill) loads and reads as absent', async () => {
    const h = makeRegistry()
    await h.registry.record(ROOT, 'th1', 'test-fixer')
    const reloaded = makeRegistry()
    await reloaded.registry.ensureRootReady(ROOT)
    expect(reloaded.registry.get(ROOT, 'th1')).toEqual({
      slug: 'test-fixer',
      workspaceRoot: ROOT
    })
    expect(reloaded.registry.get(ROOT, 'th1')?.budgets).toBeUndefined()
  })

  it('a malformed budgets snapshot in the mirror degrades to absent, never a throw', async () => {
    await fs.writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        backfilledRoots: [],
        bindings: {
          [ROOT + '\u0000' + 'th1']: {
            slug: 'test-fixer',
            workspaceRoot: ROOT,
            budgets: { maxTurns: 'lots', maxWritesPerMinute: null }
          }
        }
      }),
      'utf8'
    )
    const h = makeRegistry()
    await h.registry.ensureRootReady(ROOT)
    expect(h.registry.get(ROOT, 'th1')).toEqual({ slug: 'test-fixer', workspaceRoot: ROOT })
  })

  it.each([
    { maxTurns: 1.5, maxWritesPerMinute: 10 },
    { maxTurns: 101, maxWritesPerMinute: 10 },
    { maxTurns: 10, maxWritesPerMinute: 0 },
    { maxTurns: 10, maxWritesPerMinute: 10, surprise: true }
  ])(
    'rejects persisted budgets outside the shared integer/bounds contract: %j',
    async (budgets) => {
      await fs.writeFile(
        filePath,
        JSON.stringify({
          version: 1,
          backfilledRoots: [ROOT],
          bindings: {
            [ROOT + '\u0000' + 'th-bad-budgets']: {
              slug: 'test-fixer',
              workspaceRoot: ROOT,
              budgets
            }
          }
        }),
        'utf8'
      )
      const h = makeRegistry()
      await h.registry.ensureRootReady(ROOT)
      expect(h.registry.get(ROOT, 'th-bad-budgets')).toEqual({
        slug: 'test-fixer',
        workspaceRoot: ROOT
      })
    }
  )
})

describe('raw invocation template snapshot at bind (step 8)', () => {
  const TEMPLATE = "mytool '--ask' {prompt}"

  it('records the validated template and round-trips it through the persisted mirror', async () => {
    const first = makeRegistry()
    expect(
      await first.registry.record(ROOT, 'th-raw', 'raw-runner', undefined, TEMPLATE, 'raw')
    ).toEqual({ ok: true })
    expect(first.registry.get(ROOT, 'th-raw')?.adapter).toBe('raw')
    expect(first.registry.get(ROOT, 'th-raw')?.invocationTemplate).toBe(TEMPLATE)

    const reloaded = makeRegistry()
    await reloaded.registry.ensureRootReady(ROOT)
    expect(reloaded.registry.get(ROOT, 'th-raw')?.adapter).toBe('raw')
    expect(reloaded.registry.get(ROOT, 'th-raw')?.invocationTemplate).toBe(TEMPLATE)
  })

  it('same-slug re-record never refreshes the bind-time template snapshot', async () => {
    const h = makeRegistry()
    await h.registry.record(ROOT, 'th-raw', 'raw-runner', undefined, TEMPLATE, 'raw')
    expect(
      await h.registry.record(ROOT, 'th-raw', 'raw-runner', undefined, 'other {prompt}', 'raw')
    ).toEqual({ ok: true })
    expect(h.registry.get(ROOT, 'th-raw')?.invocationTemplate).toBe(TEMPLATE)

    const reloaded = makeRegistry()
    await reloaded.registry.ensureRootReady(ROOT)
    expect(reloaded.registry.get(ROOT, 'th-raw')?.invocationTemplate).toBe(TEMPLATE)
  })

  it('refuses a malformed template on a new binding without minting it', async () => {
    const h = makeRegistry()
    const result = await h.registry.record(
      ROOT,
      'th-raw',
      'raw-runner',
      undefined,
      'no prompt',
      'raw'
    )
    expect(result.ok).toBe(false)
    expect(h.registry.get(ROOT, 'th-raw')).toBeUndefined()
  })

  it('refuses a terminal-control template on a new binding without minting it', async () => {
    const h = makeRegistry()
    const result = await h.registry.record(
      ROOT,
      'th-controlled',
      'raw-runner',
      undefined,
      'mytool \x15{prompt}',
      'raw'
    )

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Ctrl-U') })
    expect(h.registry.get(ROOT, 'th-controlled')).toBeUndefined()
  })

  it('malformed persisted templates degrade to absent while the binding survives', async () => {
    await fs.writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        backfilledRoots: [ROOT],
        bindings: {
          [ROOT + '\u0000' + 'th-raw']: {
            slug: 'raw-runner',
            workspaceRoot: ROOT,
            adapter: 'raw',
            invocationTemplate: 'missing-placeholder'
          }
        }
      }),
      'utf8'
    )
    const h = makeRegistry()
    await h.registry.ensureRootReady(ROOT)
    expect(h.registry.get(ROOT, 'th-raw')).toEqual({
      slug: 'raw-runner',
      workspaceRoot: ROOT,
      adapter: 'raw'
    })
  })

  it('persisted terminal-control templates degrade to no raw-send readiness', async () => {
    await fs.writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        backfilledRoots: [ROOT],
        bindings: {
          [ROOT + '\u0000' + 'th-controlled']: {
            slug: 'raw-runner',
            workspaceRoot: ROOT,
            adapter: 'raw',
            invocationTemplate: 'mytool \x15{prompt}'
          }
        }
      }),
      'utf8'
    )

    const h = makeRegistry()
    await h.registry.ensureRootReady(ROOT)
    expect(h.registry.get(ROOT, 'th-controlled')).toEqual({
      slug: 'raw-runner',
      workspaceRoot: ROOT,
      adapter: 'raw'
    })
  })

  it('trust-on-upgrade backfills never acquire an invocation template', async () => {
    const h = makeRegistry({
      listThreadAgentIds: async () => [{ threadId: 'th-legacy', agentId: 'raw-runner' }],
      harnessDirExists: async () => true
    })
    await h.registry.ensureRootReady(ROOT)
    expect(h.registry.get(ROOT, 'th-legacy')).toEqual({
      slug: 'raw-runner',
      workspaceRoot: ROOT
    })
  })
})

describe('adapter snapshot at bind (step 8)', () => {
  it('persists a structured adapter and refuses a same-slug adapter change', async () => {
    const first = makeRegistry()
    expect(
      await first.registry.record(ROOT, 'th-adapter', 'test-fixer', undefined, undefined, 'claude')
    ).toEqual({ ok: true })

    const mismatch = await first.registry.record(
      ROOT,
      'th-adapter',
      'test-fixer',
      undefined,
      undefined,
      'codex'
    )
    expect(mismatch.ok).toBe(false)
    if (!mismatch.ok) expect(mismatch.error).toContain('already bound to adapter "claude"')

    const reloaded = makeRegistry()
    await reloaded.registry.ensureRootReady(ROOT)
    expect(reloaded.registry.get(ROOT, 'th-adapter')).toEqual({
      slug: 'test-fixer',
      workspaceRoot: ROOT,
      adapter: 'claude'
    })
  })

  it('an invalid persisted adapter degrades to legacy and cannot carry a raw template', async () => {
    await fs.writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        backfilledRoots: [ROOT],
        bindings: {
          [ROOT + '\u0000' + 'th-invalid-adapter']: {
            slug: 'raw-runner',
            workspaceRoot: ROOT,
            adapter: 'shell',
            invocationTemplate: 'must-not-cross {prompt}'
          }
        }
      }),
      'utf8'
    )

    const h = makeRegistry()
    await h.registry.ensureRootReady(ROOT)
    expect(h.registry.get(ROOT, 'th-invalid-adapter')).toEqual({
      slug: 'raw-runner',
      workspaceRoot: ROOT
    })
  })

  it('a same-slug record never upgrades an adapter-less legacy binding', async () => {
    const first = makeRegistry()
    await first.registry.record(ROOT, 'th-legacy-adapter', 'test-fixer')

    expect(
      await first.registry.record(
        ROOT,
        'th-legacy-adapter',
        'test-fixer',
        { maxTurns: 3, maxWritesPerMinute: 4 },
        undefined,
        'claude'
      )
    ).toEqual({ ok: true })
    expect(first.registry.get(ROOT, 'th-legacy-adapter')).toEqual({
      slug: 'test-fixer',
      workspaceRoot: ROOT
    })

    const reloaded = makeRegistry()
    await reloaded.registry.ensureRootReady(ROOT)
    expect(reloaded.registry.get(ROOT, 'th-legacy-adapter')).toEqual({
      slug: 'test-fixer',
      workspaceRoot: ROOT
    })
  })

  it('refuses raw adapter/template shape mismatches before minting a binding', async () => {
    const h = makeRegistry()
    expect(
      await h.registry.record(
        ROOT,
        'th-missing-template',
        'raw-runner',
        undefined,
        undefined,
        'raw'
      )
    ).toMatchObject({ ok: false })
    expect(
      await h.registry.record(
        ROOT,
        'th-structured-template',
        'test-fixer',
        undefined,
        'tool {prompt}',
        'claude'
      )
    ).toMatchObject({ ok: false })
    expect(h.registry.get(ROOT, 'th-missing-template')).toBeUndefined()
    expect(h.registry.get(ROOT, 'th-structured-template')).toBeUndefined()
  })
})
