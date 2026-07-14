/**
 * Watcher health + restart/backoff wiring in ipc/git.ts (workstation step 2,
 * contracts §4 v1.2.1). Electron and the heavy service modules are mocked;
 * the module under test is re-imported per test so its module-level health
 * state starts fresh (same pattern as agent-ipc.test.ts).
 *
 * Queue scope (contracts §4 v1.3.0): the queue is multi-root — NEITHER a
 * same-root restartWatcher NOR a workspace-switch initApprovalsForRoot may
 * clear it (captured-but-unreviewed writes must never evaporate); resolution
 * stays root-bound per item inside ApprovalQueue. The first init of an app
 * run rehydrates the userData disk mirror.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AuditEntry } from '../../src/shared/agent-types'

const auditLog = vi.hoisted(() => vi.fn())

/** Per-test userData dir: the queue's disk mirror must not leak across tests. */
const userDataCtl = vi.hoisted(() => ({ dir: '' }))

const watcherCtl = vi.hoisted(() => ({
  instances: [] as Array<{
    deps: {
      onHealthChange?: (state: string, reason?: string) => void
    }
    started: number
    stopped: number
  }>,
  startBehavior: 'resolve' as 'resolve' | 'reject' | 'defer',
  /** Pending 'defer' starts, oldest first — settle to resume the caller. */
  deferredStarts: [] as Array<{ resolve: () => void; reject: (err: Error) => void }>
}))

const ipcCtl = vi.hoisted(() => ({
  handlers: new Map<string, (args?: unknown) => unknown>(),
  sends: [] as Array<[string, unknown]>
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => userDataCtl.dir) },
  shell: { trashItem: vi.fn() }
}))

vi.mock('../../src/main/typed-ipc', () => ({
  typedHandle: (channel: string, handler: (args?: unknown) => unknown) => {
    ipcCtl.handlers.set(channel, handler)
  },
  typedSend: (_win: unknown, channel: string, data: unknown) => {
    ipcCtl.sends.push([channel, data])
  }
}))

vi.mock('../../src/main/window-registry', () => ({
  getMainWindow: () => ({}) as never
}))

vi.mock('../../src/main/services/workspace-service', () => ({
  getWorkspaceService: () => ({ current: () => ({ root: '/ws' }) })
}))

vi.mock('../../src/main/ipc/documents', () => ({
  getDocumentManager: () => ({ hasPendingWrite: () => false })
}))

vi.mock('../../src/main/services/audit-logger', () => ({
  AuditLogger: class {
    log = auditLog
  }
}))

vi.mock('../../src/main/services/agent-write-watcher', () => ({
  AgentWriteWatcher: class {
    deps: { onHealthChange?: (state: string, reason?: string) => void }
    started = 0
    stopped = 0
    constructor(deps: { onHealthChange?: (state: string, reason?: string) => void }) {
      this.deps = deps
      watcherCtl.instances.push(this)
    }

    async start(): Promise<void> {
      this.started += 1
      this.deps.onHealthChange?.('starting')
      if (watcherCtl.startBehavior === 'reject') throw new Error('start failed')
      if (watcherCtl.startBehavior === 'defer') {
        // Mirrors a real chokidar scan in flight: the caller stays suspended
        // at `await start()` until the test settles the promise.
        await new Promise<void>((resolve, reject) => {
          watcherCtl.deferredStarts.push({ resolve, reject })
        })
      }
      this.deps.onHealthChange?.('watching')
    }

    async stop(): Promise<void> {
      this.stopped += 1
      this.deps.onHealthChange?.('stopped')
    }

    suppress(): void {
      // noop — the queue's discard wrapper calls this on the singleton
    }
  }
}))

type GitModule = typeof import('../../src/main/ipc/git')

async function loadModule(): Promise<GitModule> {
  const mod = await import('../../src/main/ipc/git')
  mod.registerGitIpc()
  return mod
}

function healthStates(): string[] {
  return ipcCtl.sends
    .filter(([channel]) => channel === 'approvals:watcher-health')
    .map(([, data]) => (data as { state: string }).state)
}

function recoveredEntries(): AuditEntry[] {
  return auditLog.mock.calls
    .map((c) => c[0] as AuditEntry)
    .filter((e) => e.tool === 'approvals:watcher-recovered')
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.useFakeTimers()
  userDataCtl.dir = mkdtempSync(join(tmpdir(), 'te-watcher-health-userdata-'))
  watcherCtl.instances.length = 0
  watcherCtl.startBehavior = 'resolve'
  watcherCtl.deferredStarts.length = 0
  ipcCtl.handlers.clear()
  ipcCtl.sends.length = 0
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(userDataCtl.dir, { recursive: true, force: true })
})

describe('watcher health state + broadcast', () => {
  it('starts stopped, transitions to watching on init, and broadcasts each state', async () => {
    const mod = await loadModule()
    expect(mod.getWatcherHealth().state).toBe('stopped')

    await mod.initApprovalsForRoot('/ws')

    expect(mod.getWatcherHealth().state).toBe('watching')
    expect(healthStates()).toEqual(['starting', 'watching'])
  })

  it('approvals:watcher-status returns the current health payload', async () => {
    const mod = await loadModule()
    await mod.initApprovalsForRoot('/ws')

    const handler = ipcCtl.handlers.get('approvals:watcher-status')
    expect(handler).toBeDefined()
    const health = (await handler!()) as ReturnType<GitModule['getWatcherHealth']>
    expect(health.state).toBe('watching')
    expect(health.attempts).toBe(0)
    expect(typeof health.since).toBe('string')
  })

  it('markApprovalsWatcherDown sets down (the main/index.ts init-failure path)', async () => {
    const mod = await loadModule()
    watcherCtl.startBehavior = 'reject'
    mod.markApprovalsWatcherDown('init failed: EACCES')
    expect(mod.getWatcherHealth().state).toBe('down')
    expect(mod.getWatcherHealth().reason).toBe('init failed: EACCES')
  })
})

describe('queue scope v1.3.0: same-root restart AND workspace switch both preserve items', () => {
  it('items survive restartWatcher and a workspace-switch initApprovalsForRoot', async () => {
    const mod = await loadModule()
    const queue = mod.getApprovalQueue()
    await mod.initApprovalsForRoot('/ws')

    // Seed a captured-but-unreviewed item, then restart against the same root.
    queue.recordWrites({ turnId: 't1', threadId: 'th1', agentId: 'a', paths: ['src/x.ts'] })
    expect(queue.list()).toHaveLength(1)

    const result = await mod.restartWatcher()
    expect(result.ok).toBe(true)
    expect(queue.list()).toHaveLength(1) // same-root restart semantics preserved exactly

    // Workspace switch (v1.3.0): the queue is multi-root — the item survives
    // with its capturedRoot; resolution stays root-bound inside the queue.
    await mod.initApprovalsForRoot('/ws2')
    expect(queue.list()).toHaveLength(1)
    expect(queue.list()[0]?.capturedRoot).toBe('/ws')
  })

  it('first init of an app run rehydrates the disk mirror; later inits do not re-run it', async () => {
    // Seed a mirror whose item's diff matches a FRESH recompute of its own
    // capturedRoot — the rehydrate-revalidate gate must pass it through.
    // The fixture root is a REAL directory with a REAL file: a nonexistent
    // root would recompute to the [diff unavailable] marker, which counts as
    // failed verification (diff-failed drop), not a match (v1.3.0).
    const fixtureRoot = join(userDataCtl.dir, 'fixture-root')
    mkdirSync(fixtureRoot, { recursive: true })
    writeFileSync(join(fixtureRoot, 'x.txt'), 'agent write\n')
    const { diff } = await import('../../src/main/services/git-service')
    const freshDiff = diff(fixtureRoot, ['x.txt'])
    expect(freshDiff).toContain('agent write') // a real diff, not the marker
    writeFileSync(
      join(userDataCtl.dir, 'approval-queue.json'),
      JSON.stringify({
        version: 1,
        items: [
          {
            id: 'pc_prev',
            kind: 'cli-change',
            threadId: 'th-prev',
            agentId: 'a',
            paths: ['x.txt'],
            diff: freshDiff,
            capturedAt: '2026-07-14T00:00:00.000Z',
            revertible: false,
            flags: {
              highVelocity: false,
              headMoved: false,
              concurrentTurns: false,
              degradedAttribution: false,
              gateDegraded: false,
              attributionSuspect: false,
              forbidden: false
            },
            capturedRoot: fixtureRoot
          }
        ]
      })
    )

    const mod = await loadModule()
    await mod.initApprovalsForRoot('/ws')
    expect(
      mod
        .getApprovalQueue()
        .list()
        .map((i) => i.id)
    ).toEqual(['pc_prev'])

    // A later workspace switch neither clears nor re-rehydrates (one-shot).
    await mod.initApprovalsForRoot('/ws2')
    expect(
      mod
        .getApprovalQueue()
        .list()
        .map((i) => i.id)
    ).toEqual(['pc_prev'])
  })

  it('a gate-confirm smuggled into the mirror is dropped at decode WITH an audit entry', async () => {
    // Contracts §4 v1.3.0: decode-level drops are audited, never silent —
    // the production load path refuses the kind before the queue's own
    // rehydrate check can see it, so the audit must come from this pipeline.
    writeFileSync(
      join(userDataCtl.dir, 'approval-queue.json'),
      JSON.stringify({
        version: 1,
        items: [{ id: 'gc_9', kind: 'gate-confirm' }]
      })
    )

    const mod = await loadModule()
    await mod.initApprovalsForRoot('/ws')

    expect(mod.getApprovalQueue().list()).toEqual([])
    const drops = auditLog.mock.calls
      .map((c) => c[0] as AuditEntry)
      .filter((e) => e.tool === 'approvals:rehydrate-drop')
    expect(drops).toHaveLength(1)
    expect(drops[0]).toMatchObject({
      decision: 'error',
      error: 'gate-confirm-never-rehydrated',
      args: { id: 'gc_9', at: 'mirror-decode' }
    })
  })

  it('restartWatcher without a bound root returns no-workspace', async () => {
    const mod = await loadModule()
    const result = await mod.restartWatcher()
    expect(result).toEqual({ ok: false, reason: 'no-workspace' })
  })
})

describe('in-flight restart vs newer restart/switch (generation guard)', () => {
  // cancelWatcherRetry only clears a PENDING timer; these pin the case where a
  // restart is already EXECUTING (suspended in start(), like a chokidar scan)
  // when a workspace switch or manual Retry overtakes it.
  it('a restart overtaken by a workspace switch retires its watcher instead of rebinding the dead root', async () => {
    const mod = await loadModule()
    await mod.initApprovalsForRoot('/ws')
    const w0 = watcherCtl.instances.at(-1)!

    watcherCtl.startBehavior = 'defer'
    const inFlight = mod.restartWatcher() // stops w0, builds w1, suspends in w1.start()
    await vi.advanceTimersByTimeAsync(0)
    const w1 = watcherCtl.instances.at(-1)!
    expect(w1).not.toBe(w0)
    expect(watcherCtl.deferredStarts).toHaveLength(1)

    watcherCtl.startBehavior = 'resolve'
    await mod.initApprovalsForRoot('/ws2') // the switch wins; w2 is current
    const w2 = watcherCtl.instances.at(-1)!
    expect(mod.getWatcherHealth().state).toBe('watching')

    // The loser's scan completes AFTER the switch: it must abort, stop its
    // own watcher (no live orphan), and leave w2 + health untouched.
    watcherCtl.deferredStarts[0].resolve()
    const result = await inFlight
    expect(result).toEqual({ ok: false, reason: 'watcher-restart-superseded' })
    expect(w1.stopped).toBeGreaterThanOrEqual(1)
    expect(w2.stopped).toBe(0)
    expect(mod.getWatcherHealth().state).toBe('watching') // w1's late 'watching' was inert
  })

  it('a superseded restart whose start FAILS later reports nothing: no false down, no backoff churn', async () => {
    const mod = await loadModule()
    await mod.initApprovalsForRoot('/ws')

    watcherCtl.startBehavior = 'defer'
    const inFlight = mod.restartWatcher()
    await vi.advanceTimersByTimeAsync(0)
    expect(watcherCtl.deferredStarts).toHaveLength(1)

    // Manual Retry wins the race and recovers.
    watcherCtl.startBehavior = 'resolve'
    const retry = ipcCtl.handlers.get('approvals:watcher-retry')
    expect(retry).toBeDefined()
    const retryResult = (await retry!()) as { ok: boolean }
    expect(retryResult.ok).toBe(true)
    expect(mod.getWatcherHealth().state).toBe('watching')

    // The loser's ready race rejects long after (real chokidar: the winner's
    // stop() strips 'ready', so the ready timeout fires up to 30s later). It
    // must not flip the recovered state, bump attempts, or arm a retry.
    const instancesBefore = watcherCtl.instances.length
    watcherCtl.deferredStarts[0].reject(new Error('watcher ready timeout after 30000ms'))
    const result = await inFlight
    expect(result).toEqual({ ok: false, reason: 'watcher-restart-superseded' })
    expect(mod.getWatcherHealth().state).toBe('watching')
    expect(mod.getWatcherHealth().attempts).toBe(0)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(watcherCtl.instances.length).toBe(instancesBefore) // no backoff retry armed
    expect(recoveredEntries()).toHaveLength(0) // no bogus coverage-gap entry
  })
})

describe('backoff schedule + cap + manual reset', () => {
  it('retries at 1s/5s/30s (30s repeating), caps at 5, then down-until-manual', async () => {
    const mod = await loadModule()
    watcherCtl.startBehavior = 'reject'
    await expect(mod.initApprovalsForRoot('/ws')).rejects.toThrow('start failed')
    mod.markApprovalsWatcherDown('start failed') // what main/index.ts's catch does
    const initInstances = watcherCtl.instances.length

    const expectedDelays = [1_000, 5_000, 30_000, 30_000, 30_000]
    for (let attempt = 0; attempt < expectedDelays.length; attempt++) {
      const before = watcherCtl.instances.length
      await vi.advanceTimersByTimeAsync(expectedDelays[attempt] - 1)
      expect(watcherCtl.instances.length).toBe(before) // not yet
      await vi.advanceTimersByTimeAsync(1)
      expect(watcherCtl.instances.length).toBe(before + 1) // retried, failed again
      expect(mod.getWatcherHealth().state).toBe('down')
    }
    expect(watcherCtl.instances.length).toBe(initInstances + 5)
    expect(mod.getWatcherHealth().attempts).toBe(5)

    // Cap reached: no more automatic retries, ever.
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(watcherCtl.instances.length).toBe(initInstances + 5)
    expect(mod.getWatcherHealth().state).toBe('down')

    // Manual Retry resets the cap and recovers.
    watcherCtl.startBehavior = 'resolve'
    const retry = ipcCtl.handlers.get('approvals:watcher-retry')
    expect(retry).toBeDefined()
    const result = (await retry!()) as { ok: boolean }
    expect(result.ok).toBe(true)
    expect(mod.getWatcherHealth().state).toBe('watching')
    expect(mod.getWatcherHealth().attempts).toBe(0)
  })

  it('a successful automatic retry resets the backoff cycle', async () => {
    const mod = await loadModule()
    watcherCtl.startBehavior = 'reject'
    await expect(mod.initApprovalsForRoot('/ws')).rejects.toThrow('start failed')
    mod.markApprovalsWatcherDown('start failed')

    watcherCtl.startBehavior = 'resolve'
    await vi.advanceTimersByTimeAsync(1_000)
    expect(mod.getWatcherHealth().state).toBe('watching')
    expect(mod.getWatcherHealth().attempts).toBe(0)
  })

  it('stopApprovals cancels a pending backoff retry (workspace-switch race)', async () => {
    const mod = await loadModule()
    watcherCtl.startBehavior = 'reject'
    await expect(mod.initApprovalsForRoot('/ws')).rejects.toThrow('start failed')
    mod.markApprovalsWatcherDown('start failed')
    const before = watcherCtl.instances.length

    await mod.stopApprovals()
    expect(mod.getWatcherHealth().state).toBe('stopped')

    // The armed 1s retry must NOT fire against the dead root.
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(watcherCtl.instances.length).toBe(before)
    expect(mod.getWatcherHealth().state).toBe('stopped')
  })
})

describe('recovery audit gap entry (escapes logged, never silent)', () => {
  it('writes one approvals:watcher-recovered entry spanning the down window', async () => {
    const mod = await loadModule()
    watcherCtl.startBehavior = 'reject'
    await expect(mod.initApprovalsForRoot('/ws')).rejects.toThrow('start failed')
    mod.markApprovalsWatcherDown('start failed')
    expect(recoveredEntries()).toHaveLength(0)

    watcherCtl.startBehavior = 'resolve'
    await vi.advanceTimersByTimeAsync(1_000)
    expect(mod.getWatcherHealth().state).toBe('watching')

    const entries = recoveredEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0].decision).toBe('error')
    expect(entries[0].error).toContain('not captured for review')
    expect(typeof entries[0].args.gapStartedAt).toBe('string')
    expect(typeof entries[0].args.gapEndedAt).toBe('string')
  })

  it('a healthy init with no prior gap writes no recovery entry', async () => {
    const mod = await loadModule()
    await mod.initApprovalsForRoot('/ws')
    expect(recoveredEntries()).toHaveLength(0)
  })
})

describe('turn-start gate-health probe (OQ6: visibly degrade, never block)', () => {
  it('turns opened while not watching are tagged; healthy turns are not', async () => {
    const mod = await loadModule()
    const { getCliTurnRegistry } = await import('../../src/main/services/cli-turn-registry')

    // registerGitIpc wired the probe; health is 'stopped' before init.
    const degraded = getCliTurnRegistry().turnStarted({
      threadId: 'th1',
      agentId: 'a',
      cwd: '/ws'
    })
    expect(degraded.gateDegradedAtStart).toBe(true)

    await mod.initApprovalsForRoot('/ws')
    const clean = getCliTurnRegistry().turnStarted({
      threadId: 'th2',
      agentId: 'a',
      cwd: '/ws'
    })
    expect(clean.gateDegradedAtStart).toBe(false)
  })
})
