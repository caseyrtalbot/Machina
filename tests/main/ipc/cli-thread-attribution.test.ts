// @vitest-environment node
/**
 * Attribution validation at the cli-thread IPC boundary (workstation Phase 2
 * step 3, contracts §4 v1.2.2): resolveRequestedAgentId's degrade-not-fail
 * semantics, handler wiring into the spawner, and the frontmatter-tamper
 * repro against a REAL HarnessRunRegistry persisted mirror.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AuditEntry } from '@shared/agent-types'
import type { HarnessBinding } from '../../../src/main/services/harness-run-registry'

const ipcCtl = vi.hoisted(() => ({
  handlers: new Map<string, (args?: unknown) => unknown>()
}))

const spawnerCtl = vi.hoisted(() => ({
  spawns: [] as unknown[][],
  inputs: [] as unknown[][]
}))

const registryCtl = vi.hoisted(() => ({
  current: null as null | {
    ensureRootReady(root: string): Promise<void>
    get(root: string, threadId: string): HarnessBinding | undefined
  }
}))

vi.mock('electron', async () => {
  const os = await import('node:os')
  const path = await import('node:path')
  return {
    app: { getPath: () => path.join(os.tmpdir(), 'machina-cli-thread-attribution-userdata') }
  }
})

vi.mock('../../../src/main/typed-ipc', () => ({
  typedHandle: (channel: string, handler: (args?: unknown) => unknown) => {
    ipcCtl.handlers.set(channel, handler)
  }
}))

vi.mock('../../../src/main/ipc/shell', () => ({
  getShellService: () => ({}),
  getCliAgentThreadBridge: () => ({})
}))

// The handlers construct the spawner; only its call surface matters here —
// the resolved attribution must arrive in the spawn/input positional args.
vi.mock('../../../src/main/services/cli-thread-spawner', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../src/main/services/cli-thread-spawner')>()
  class FakeSpawner {
    async spawn(...args: unknown[]): Promise<unknown> {
      spawnerCtl.spawns.push(args)
      return { ok: true, sessionId: 's1' }
    }

    async input(...args: unknown[]): Promise<unknown> {
      spawnerCtl.inputs.push(args)
      return { ok: true }
    }

    hasLiveSession(): boolean {
      return false
    }
  }
  return { ...actual, CliThreadSpawner: FakeSpawner }
})

// Keep the real HarnessRunRegistry class (the tamper repro needs it); only
// the singleton the handlers reach for is swapped per test.
vi.mock('../../../src/main/services/harness-run-registry', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../src/main/services/harness-run-registry')>()
  return {
    ...actual,
    getHarnessRunRegistry: () => registryCtl.current
  }
})

import { resolveRequestedAgentId, registerCliThreadIpc } from '../../../src/main/ipc/cli-thread'
import { HarnessRunRegistry } from '../../../src/main/services/harness-run-registry'

const ROOT = '/ws'

function fakeRegistry(binding?: HarnessBinding): {
  ensureRootReady: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
} {
  return {
    ensureRootReady: vi.fn(async () => {}),
    get: vi.fn(() => binding)
  }
}

function collectAudit(): { entries: AuditEntry[]; log: (entry: AuditEntry) => void } {
  const entries: AuditEntry[] = []
  return { entries, log: (entry) => entries.push(entry) }
}

describe('resolveRequestedAgentId', () => {
  it('an absent agentId passes through untouched: no lookup, no audit, no flag', async () => {
    const registry = fakeRegistry()
    const audit = collectAudit()
    const result = await resolveRequestedAgentId(
      'cli-thread:input',
      'th1',
      ROOT,
      undefined,
      registry,
      audit
    )
    expect(result).toEqual({ agentId: undefined, attributionSuspect: false })
    expect(registry.ensureRootReady).not.toHaveBeenCalled()
    expect(audit.entries).toEqual([])
  })

  it('a malformed agentId degrades before any registry access', async () => {
    const registry = fakeRegistry()
    const audit = collectAudit()
    const result = await resolveRequestedAgentId(
      'cli-thread:spawn',
      'th1',
      ROOT,
      'bad id!',
      registry,
      audit
    )
    expect(result).toEqual({ agentId: undefined, attributionSuspect: true })
    expect(registry.ensureRootReady).not.toHaveBeenCalled()
    expect(audit.entries).toHaveLength(1)
    expect(audit.entries[0].tool).toBe('cli-agent:attribution-mismatch')
    expect(audit.entries[0].decision).toBe('denied')
    expect(audit.entries[0].args).toMatchObject({
      channel: 'cli-thread:spawn',
      threadId: 'th1',
      requested: 'bad id!',
      reason: 'malformed'
    })
  })

  it('a binding match proceeds with the requested slug and no audit', async () => {
    const registry = fakeRegistry({ slug: 'test-fixer', workspaceRoot: ROOT })
    const audit = collectAudit()
    const result = await resolveRequestedAgentId(
      'cli-thread:input',
      'th1',
      ROOT,
      'test-fixer',
      registry,
      audit
    )
    expect(result).toEqual({ agentId: 'test-fixer', attributionSuspect: false })
    expect(registry.ensureRootReady).toHaveBeenCalledWith(ROOT)
    expect(audit.entries).toEqual([])
  })

  it('a binding mismatch degrades, audits the bound slug, and flags the turn', async () => {
    const registry = fakeRegistry({ slug: 'agent-x', workspaceRoot: ROOT })
    const audit = collectAudit()
    const result = await resolveRequestedAgentId(
      'cli-thread:input',
      'th1',
      ROOT,
      'agent-y',
      registry,
      audit
    )
    expect(result).toEqual({ agentId: undefined, attributionSuspect: true })
    expect(audit.entries).toHaveLength(1)
    expect(audit.entries[0].args).toMatchObject({
      reason: 'binding-mismatch',
      requested: 'agent-y',
      boundSlug: 'agent-x'
    })
  })

  it('a forwarded agentId on an unbound thread degrades + flags (post-backfill rule)', async () => {
    const registry = fakeRegistry(undefined)
    const audit = collectAudit()
    const result = await resolveRequestedAgentId(
      'cli-thread:input',
      'th1',
      ROOT,
      'agent-x',
      registry,
      audit
    )
    expect(result).toEqual({ agentId: undefined, attributionSuspect: true })
    expect(audit.entries).toHaveLength(1)
    expect(audit.entries[0].args).toMatchObject({ reason: 'unbound-thread' })
  })

  it('a throwing registry degrades + flags — the turn is never hard-failed', async () => {
    // One crafted file in the watcher-ignored threads dir (or ENOSPC on the
    // mirror) must not reject spawn/input for the whole workspace.
    const registry = {
      ensureRootReady: vi.fn(async () => {
        throw new Error('backfill scan exploded')
      }),
      get: vi.fn(() => undefined)
    }
    const audit = collectAudit()
    const result = await resolveRequestedAgentId(
      'cli-thread:input',
      'th1',
      ROOT,
      'agent-x',
      registry,
      audit
    )
    expect(result).toEqual({ agentId: undefined, attributionSuspect: true })
    expect(audit.entries).toHaveLength(1)
    expect(audit.entries[0].tool).toBe('cli-agent:attribution-mismatch')
    expect(audit.entries[0].args).toMatchObject({ reason: 'registry-error' })
  })
})

describe('handler wiring (spawn + input forward the RESOLVED attribution)', () => {
  beforeEach(() => {
    ipcCtl.handlers.clear()
    spawnerCtl.spawns.length = 0
    spawnerCtl.inputs.length = 0
    registerCliThreadIpc()
  })

  it('cli-thread:spawn passes the validated slug + suspect=false to the spawner', async () => {
    registryCtl.current = {
      ensureRootReady: async () => {},
      get: () => ({ slug: 'test-fixer', workspaceRoot: ROOT })
    }
    const handler = ipcCtl.handlers.get('cli-thread:spawn')
    expect(handler).toBeDefined()
    await handler?.({ threadId: 'th1', identity: 'cli-claude', cwd: ROOT, agentId: 'test-fixer' })
    expect(spawnerCtl.spawns).toEqual([['th1', 'cli-claude', ROOT, 'test-fixer', undefined, false]])
  })

  it('cli-thread:input degrades a mismatched slug to undefined + suspect=true', async () => {
    registryCtl.current = {
      ensureRootReady: async () => {},
      get: () => ({ slug: 'agent-x', workspaceRoot: ROOT })
    }
    const handler = ipcCtl.handlers.get('cli-thread:input')
    expect(handler).toBeDefined()
    await handler?.({
      threadId: 'th1',
      identity: 'cli-claude',
      text: 'go',
      cwd: ROOT,
      agentId: 'agent-y'
    })
    expect(spawnerCtl.inputs).toEqual([
      ['th1', 'cli-claude', 'go', ROOT, undefined, undefined, true]
    ])
  })
})

describe('frontmatter tamper repro (real registry, persisted mirror across relaunch)', () => {
  let dir: string
  let filePath: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-thread-attribution-'))
    filePath = path.join(dir, 'harness-bindings.json')
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('a tampered agent_id resolves to identity fallback + suspect + audit; the binding holds', async () => {
    // Session 1: main binds the thread to agent-x via its own validation.
    const first = new HarnessRunRegistry({
      filePath,
      audit: { log: () => {} },
      listThreadAgentIds: async () => [],
      harnessDirExists: async () => true
    })
    expect(await first.record(ROOT, 'th-tamper', 'agent-x')).toEqual({ ok: true })

    // Relaunch: fresh instance over the same mirror. The tampered thread
    // frontmatter now claims agent-y — the backfill must NOT re-trust it.
    const relaunchAudit = collectAudit()
    const second = new HarnessRunRegistry({
      filePath,
      audit: relaunchAudit,
      listThreadAgentIds: async () => [{ threadId: 'th-tamper', agentId: 'agent-y' }],
      harnessDirExists: async () => true
    })

    const audit = collectAudit()
    const resolved = await resolveRequestedAgentId(
      'cli-thread:input',
      'th-tamper',
      ROOT,
      'agent-y',
      second,
      audit
    )
    expect(resolved).toEqual({ agentId: undefined, attributionSuspect: true })
    expect(audit.entries).toHaveLength(1)
    expect(audit.entries[0].tool).toBe('cli-agent:attribution-mismatch')
    expect(audit.entries[0].args).toMatchObject({
      threadId: 'th-tamper',
      requested: 'agent-y',
      reason: 'binding-mismatch',
      boundSlug: 'agent-x'
    })
    // Write-once held: the tamper minted no binding and no backfill audit.
    expect(second.get(ROOT, 'th-tamper')).toEqual({ slug: 'agent-x', workspaceRoot: ROOT })
    expect(relaunchAudit.entries).toEqual([])

    // The genuinely bound slug still validates cleanly after the tamper.
    const clean = collectAudit()
    const ok = await resolveRequestedAgentId(
      'cli-thread:input',
      'th-tamper',
      ROOT,
      'agent-x',
      second,
      clean
    )
    expect(ok).toEqual({ agentId: 'agent-x', attributionSuspect: false })
    expect(clean.entries).toEqual([])
  })
})
