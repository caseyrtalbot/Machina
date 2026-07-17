// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'fs/promises'
import { EventEmitter } from 'events'
import { tmpdir } from 'os'
import { join } from 'path'
import type { FSWatcher } from 'chokidar'
import { isHarnessProtectedPath, TE_DIR } from '@shared/constants'
import type { AuditEntry } from '@shared/agent-types'
import type { GitOpResult, PendingChange } from '@shared/git-types'
import type { BatchedEvent } from '../event-batcher'
import { CliTurnRegistry, type ActiveTurnMatch } from '../cli-turn-registry'
import type { RecordWritesOpts } from '../approval-queue'
import { isWatcherIgnored, partitionBatch, AgentWriteWatcher } from '../agent-write-watcher'

const ROOT = '/ws'

function ev(relPath: string): BatchedEvent {
  return { path: join(ROOT, relPath), event: 'change' }
}

function makeMatch(overrides: Partial<ActiveTurnMatch> = {}): ActiveTurnMatch {
  return {
    turn: {
      turnId: 't1',
      threadId: 'th1',
      agentId: 'agent-a',
      cwd: ROOT,
      headShaAtStart: 'sha-start',
      queueCommitShas: [],
      startedAt: 1000,
      endedAt: null
    },
    concurrent: false,
    degraded: false,
    attributionSuspect: false,
    ...overrides
  }
}

describe('partitionBatch', () => {
  const baseDeps = {
    isSelfWrite: () => false,
    turn: makeMatch(),
    forbiddenMatcher: isHarnessProtectedPath,
    root: ROOT
  }

  it('drops self-writes', () => {
    const events = [ev('src/foo.ts')]
    const parts = partitionBatch(events, { ...baseDeps, isSelfWrite: () => true })
    expect(parts.selfWrites).toEqual(events)
    expect(parts.forbidden).toEqual([])
    expect(parts.attributed).toEqual([])
    expect(parts.unattributed).toEqual([])
  })

  it.each(['.env', `${TE_DIR}/agents/a/state.md`])(
    'attributes %s when a turn match is present',
    (relPath) => {
      const events = [ev(relPath)]
      const parts = partitionBatch(events, baseDeps)
      expect(parts.attributed).toEqual(events)
      expect(parts.forbidden).toEqual([])
      expect(parts.unattributed).toEqual([])
    }
  )

  it.each([
    `${TE_DIR}/agents/a/verify.sh`,
    `${TE_DIR}/agents/a/rules.md`,
    '.machina-dev/agents/x/verify.sh'
  ])('classifies %s as forbidden even with an active turn', (relPath) => {
    const events = [ev(relPath)]
    const parts = partitionBatch(events, baseDeps)
    expect(parts.forbidden).toEqual(events)
    expect(parts.attributed).toEqual([])
    expect(parts.unattributed).toEqual([])
  })

  it('routes to unattributed when no turn matches', () => {
    const events = [ev('src/foo.ts'), ev('.env')]
    const parts = partitionBatch(events, { ...baseDeps, turn: null })
    expect(parts.unattributed).toEqual(events)
    expect(parts.attributed).toEqual([])
    expect(parts.forbidden).toEqual([])
  })

  it('self-write beats forbidden: user editing rules.md with the doc open is dropped', () => {
    const rulesPath = `${TE_DIR}/agents/a/rules.md`
    const events = [ev(rulesPath)]
    const parts = partitionBatch(events, {
      ...baseDeps,
      isSelfWrite: (abs) => abs === join(ROOT, rulesPath)
    })
    expect(parts.selfWrites).toEqual(events)
    expect(parts.forbidden).toEqual([])
  })
})

describe('isWatcherIgnored', () => {
  it.each([
    `${TE_DIR}/state.json`,
    `${TE_DIR}/threads/t1.md`,
    `${TE_DIR}/artifacts/x`,
    `${TE_DIR}/embeddings/y`
  ])('ignores app-state churn: %s', (relPath) => {
    expect(isWatcherIgnored(relPath)).toBe(true)
  })

  it.each([
    `${TE_DIR}/agents/a/state.md`,
    '.env',
    '.gitignore',
    'src/deep/.env',
    'app/build/out.js',
    'packages/lib/out/z',
    'scripts/dist/gen.js'
  ])('watches %s (build dirs only pruned at top level)', (relPath) => {
    expect(isWatcherIgnored(relPath)).toBe(false)
  })

  it.each(['.git/HEAD', 'src/.git/config', 'node_modules/pkg/index.js', 'a/node_modules/b'])(
    'prunes universal infra dirs at any depth: %s',
    (relPath) => {
      expect(isWatcherIgnored(relPath)).toBe(true)
    }
  )

  it.each(['dist/main.js', 'build/x', 'out/y'])(
    'prunes top-level build-output dirs: %s',
    (relPath) => {
      expect(isWatcherIgnored(relPath)).toBe(true)
    }
  )

  it('does not ignore the TE_DIR root itself', () => {
    expect(isWatcherIgnored(TE_DIR)).toBe(false)
  })
})

describe('AgentWriteWatcher.handleBatch', () => {
  interface Harness {
    watcher: AgentWriteWatcher
    recordWrites: ReturnType<typeof vi.fn>
    autoReject: ReturnType<typeof vi.fn>
    auditLog: ReturnType<typeof vi.fn>
    healthChanges: Array<[string, string | undefined]>
  }

  function makeHarness(opts: {
    match: ActiveTurnMatch | null
    headSha?: string | null
    isSelfWrite?: (absPath: string) => boolean
    now?: () => number
    commitsBetween?: (root: string, from: string, to: string) => readonly string[] | null
    recordWrites?: ReturnType<typeof vi.fn<(opts: RecordWritesOpts) => PendingChange>>
    autoReject?: ReturnType<
      typeof vi.fn<(opts: RecordWritesOpts, expectedRoot?: string) => Promise<GitOpResult>>
    >
  }): Harness {
    const recordWrites = opts.recordWrites ?? vi.fn((): PendingChange => ({}) as PendingChange)
    const autoReject = opts.autoReject ?? vi.fn(async (): Promise<GitOpResult> => ({ ok: true }))
    const auditLog = vi.fn()
    const healthChanges: Array<[string, string | undefined]> = []
    const watcher = new AgentWriteWatcher({
      root: ROOT,
      registry: { activeTurnFor: () => opts.match },
      queue: { recordWrites, autoReject },
      audit: { log: auditLog },
      isSelfWrite: opts.isSelfWrite ?? (() => false),
      headSha: () => (opts.headSha === undefined ? 'sha-start' : opts.headSha),
      // Default: any HEAD delta is unexplained by queue commits.
      commitsBetween: opts.commitsBetween ?? (() => ['unexplained-sha']),
      now: opts.now,
      onHealthChange: (state, reason) => healthChanges.push([state, reason])
    })
    return { watcher, recordWrites, autoReject, auditLog, healthChanges }
  }

  it('records attributed writes with relative paths and all-false flags', () => {
    const h = makeHarness({ match: makeMatch() })
    h.watcher.handleBatch([ev('.env'), ev(`${TE_DIR}/agents/a/state.md`), ev('src/foo.ts')])
    expect(h.recordWrites).toHaveBeenCalledTimes(1)
    const call = h.recordWrites.mock.calls[0][0] as RecordWritesOpts
    expect(call.turnId).toBe('t1')
    expect(call.threadId).toBe('th1')
    expect(call.agentId).toBe('agent-a')
    expect(call.paths).toEqual(['.env', `${TE_DIR}/agents/a/state.md`, 'src/foo.ts'])
    expect(call.flags).toEqual({
      highVelocity: false,
      headMoved: false,
      concurrentTurns: false,
      degradedAttribution: false,
      gateDegraded: false,
      attributionSuspect: false
    })
    expect(h.autoReject).not.toHaveBeenCalled()
    expect(h.auditLog).not.toHaveBeenCalled()
  })

  it('sets headMoved exactly when the injected headSha differs from headShaAtStart', () => {
    const moved = makeHarness({ match: makeMatch(), headSha: 'sha-other' })
    moved.watcher.handleBatch([ev('src/foo.ts')])
    const movedCall = moved.recordWrites.mock.calls[0][0] as RecordWritesOpts
    expect(movedCall.flags?.headMoved).toBe(true)

    const still = makeHarness({ match: makeMatch(), headSha: 'sha-start' })
    still.watcher.handleBatch([ev('src/foo.ts')])
    const stillCall = still.recordWrites.mock.calls[0][0] as RecordWritesOpts
    expect(stillCall.flags?.headMoved).toBe(false)
  })

  it('flows concurrent and degraded through from the ActiveTurnMatch', () => {
    const h = makeHarness({ match: makeMatch({ concurrent: true, degraded: true }) })
    h.watcher.handleBatch([ev('src/foo.ts')])
    const call = h.recordWrites.mock.calls[0][0] as RecordWritesOpts
    expect(call.flags?.concurrentTurns).toBe(true)
    expect(call.flags?.degradedAttribution).toBe(true)
  })

  it('flows attributionSuspect through from the ActiveTurnMatch (v1.2.2)', () => {
    const h = makeHarness({ match: makeMatch({ attributionSuspect: true }) })
    h.watcher.handleBatch([ev('src/foo.ts')])
    const call = h.recordWrites.mock.calls[0][0] as RecordWritesOpts
    expect(call.flags?.attributionSuspect).toBe(true)
  })

  it('routes forbidden paths to autoReject with only the forbidden relative paths', () => {
    const h = makeHarness({ match: makeMatch() })
    h.watcher.handleBatch([
      ev(`${TE_DIR}/agents/a/verify.sh`),
      ev('src/foo.ts'),
      ev(`${TE_DIR}/agents/a/rules.md`)
    ])
    expect(h.autoReject).toHaveBeenCalledTimes(1)
    const rejectCall = h.autoReject.mock.calls[0][0] as RecordWritesOpts
    expect(rejectCall.turnId).toBe('t1')
    expect(rejectCall.paths).toEqual([
      `${TE_DIR}/agents/a/verify.sh`,
      `${TE_DIR}/agents/a/rules.md`
    ])
    expect(h.autoReject.mock.calls[0][1]).toBe(ROOT)
    expect(h.recordWrites).toHaveBeenCalledTimes(1)
    const recordCall = h.recordWrites.mock.calls[0][0] as RecordWritesOpts
    expect(recordCall.paths).toEqual(['src/foo.ts'])
  })

  it('audits unattributed batches with the anomaly tool and error decision, queue untouched', () => {
    const h = makeHarness({ match: null })
    h.watcher.handleBatch([ev('src/foo.ts'), ev('.env')])
    expect(h.auditLog).toHaveBeenCalledTimes(1)
    const entry = h.auditLog.mock.calls[0][0] as AuditEntry
    expect(entry.tool).toBe('cli-agent:unattributed-write')
    expect(entry.decision).toBe('error')
    expect(entry.affectedPaths).toEqual(['src/foo.ts', '.env'])
    expect(h.recordWrites).not.toHaveBeenCalled()
    expect(h.autoReject).not.toHaveBeenCalled()
  })

  it('trips highVelocity at exactly 10 writes for a thread', () => {
    const h = makeHarness({ match: makeMatch() })
    const paths = Array.from({ length: 10 }, (_, i) => ev(`src/file-${i}.ts`))
    h.watcher.handleBatch(paths)
    expect(h.recordWrites).toHaveBeenCalledTimes(1)
    const call = h.recordWrites.mock.calls[0][0] as RecordWritesOpts
    expect(call.paths).toHaveLength(10)
    expect(call.flags?.highVelocity).toBe(true)
  })

  it('does not trip highVelocity at 9 writes on a fresh watcher', () => {
    const h = makeHarness({ match: makeMatch() })
    const paths = Array.from({ length: 9 }, (_, i) => ev(`src/file-${i}.ts`))
    h.watcher.handleBatch(paths)
    expect(h.recordWrites).toHaveBeenCalledTimes(1)
    const call = h.recordWrites.mock.calls[0][0] as RecordWritesOpts
    expect(call.paths).toHaveLength(9)
    expect(call.flags?.highVelocity).toBe(false)
  })

  it('audits a forbidden path with no active turn as unattributed, without autoReject', () => {
    const h = makeHarness({ match: null })
    h.watcher.handleBatch([ev(`${TE_DIR}/agents/a/verify.sh`)])
    expect(h.autoReject).not.toHaveBeenCalled()
    expect(h.recordWrites).not.toHaveBeenCalled()
    expect(h.auditLog).toHaveBeenCalledTimes(1)
    const entry = h.auditLog.mock.calls[0][0] as AuditEntry
    expect(entry.tool).toBe('cli-agent:unattributed-write')
    expect(entry.decision).toBe('error')
    expect(entry.error).toContain('harness-protected')
    expect(entry.affectedPaths).toEqual([`${TE_DIR}/agents/a/verify.sh`])
  })

  it('audits headMoved once per turn while recordWrites keeps flagging it', () => {
    const h = makeHarness({ match: makeMatch(), headSha: 'sha-other' })
    h.watcher.handleBatch([ev('src/foo.ts')])
    h.watcher.handleBatch([ev('src/bar.ts')])

    const headMovedEntries = h.auditLog.mock.calls
      .map((c) => c[0] as AuditEntry)
      .filter((e) => e.tool === 'cli-agent:head-moved')
    expect(headMovedEntries).toHaveLength(1)
    expect(headMovedEntries[0].decision).toBe('error')
    expect(headMovedEntries[0].args).toMatchObject({ turnId: 't1' })

    expect(h.recordWrites).toHaveBeenCalledTimes(2)
    for (const call of h.recordWrites.mock.calls) {
      expect((call[0] as RecordWritesOpts).flags?.headMoved).toBe(true)
    }
  })

  it('suppresses the gate’s own echoes until the TTL expires', () => {
    let nowMs = 1_000
    const h = makeHarness({ match: makeMatch(), now: () => nowMs })
    h.watcher.suppress(['a.txt'])

    h.watcher.handleBatch([ev('a.txt')])
    expect(h.recordWrites).not.toHaveBeenCalled()
    expect(h.auditLog).not.toHaveBeenCalled()

    h.watcher.handleBatch([ev('a.txt'), ev('src/live.ts')])
    expect(h.recordWrites).toHaveBeenCalledTimes(1)
    expect((h.recordWrites.mock.calls[0][0] as RecordWritesOpts).paths).toEqual(['src/live.ts'])

    nowMs += 10_001
    h.watcher.handleBatch([ev('a.txt')])
    expect(h.recordWrites).toHaveBeenCalledTimes(2)
    expect((h.recordWrites.mock.calls[1][0] as RecordWritesOpts).paths).toEqual(['a.txt'])
  })

  it('routes nothing after stop(), even without a prior start()', async () => {
    const h = makeHarness({ match: makeMatch() })
    await h.watcher.stop()
    h.watcher.handleBatch([ev('src/foo.ts'), ev(`${TE_DIR}/agents/a/verify.sh`)])
    expect(h.recordWrites).not.toHaveBeenCalled()
    expect(h.autoReject).not.toHaveBeenCalled()
    expect(h.auditLog).not.toHaveBeenCalled()
  })

  it('flags gateDegraded for turns opened while the watcher was unhealthy (OQ6)', () => {
    const tagged = makeHarness({
      match: makeMatch({ turn: { ...makeMatch().turn, gateDegradedAtStart: true } })
    })
    tagged.watcher.handleBatch([ev('src/foo.ts')])
    expect((tagged.recordWrites.mock.calls[0][0] as RecordWritesOpts).flags?.gateDegraded).toBe(
      true
    )

    const untagged = makeHarness({ match: makeMatch() })
    untagged.watcher.handleBatch([ev('src/foo.ts')])
    expect((untagged.recordWrites.mock.calls[0][0] as RecordWritesOpts).flags?.gateDegraded).toBe(
      false
    )
  })

  it('catches a handleBatch throw: audits, degrades, and keeps processing the next batch', () => {
    const recordWrites = vi.fn((): PendingChange => ({}) as PendingChange)
    recordWrites.mockImplementationOnce(() => {
      throw new Error('queue exploded')
    })
    const h = makeHarness({ match: makeMatch(), recordWrites })

    // Previously an uncaught main-process exception via EventBatcher's timer.
    expect(() => h.watcher.handleBatch([ev('src/foo.ts')])).not.toThrow()

    const failure = h.auditLog.mock.calls
      .map((c) => c[0] as AuditEntry)
      .find((e) => e.tool === 'cli-agent:watcher-failure')
    expect(failure).toBeDefined()
    expect(failure?.decision).toBe('error')
    expect(failure?.error).toContain('queue exploded')
    expect(failure?.affectedPaths).toEqual(['src/foo.ts'])
    expect(h.healthChanges).toContainEqual(['degraded', 'batch processing failed: queue exploded'])

    // Next batch still processes.
    h.watcher.handleBatch([ev('src/bar.ts')])
    expect(h.recordWrites).toHaveBeenCalledTimes(2)
    expect((h.recordWrites.mock.calls[1][0] as RecordWritesOpts).paths).toEqual(['src/bar.ts'])
  })

  it('catches a rejected autoReject promise: audits + degrades instead of unhandled rejection', async () => {
    const autoReject = vi.fn(async (): Promise<GitOpResult> => {
      throw new Error('discard blew up')
    })
    const h = makeHarness({ match: makeMatch(), autoReject })

    h.watcher.handleBatch([ev(`${TE_DIR}/agents/a/verify.sh`)])

    await vi.waitFor(() => {
      const failure = h.auditLog.mock.calls
        .map((c) => c[0] as AuditEntry)
        .find((e) => e.tool === 'cli-agent:watcher-failure')
      expect(failure).toBeDefined()
      expect(failure?.error).toContain('discard blew up')
      expect(failure?.affectedPaths).toEqual([`${TE_DIR}/agents/a/verify.sh`])
    })
    expect(h.healthChanges).toContainEqual(['degraded', 'auto-reject failed: discard blew up'])
  })
})

describe('AgentWriteWatcher.start() ready/error/timeout race (contracts §4 v1.2.1)', () => {
  class FakeFsWatcher extends EventEmitter {
    async close(): Promise<void> {
      // no-op: fake watcher has nothing to release
    }
  }

  function makeRaceHarness(readyTimeoutMs: number) {
    const fake = new FakeFsWatcher()
    const auditLog = vi.fn()
    const healthChanges: Array<[string, string | undefined]> = []
    const watcher = new AgentWriteWatcher({
      root: ROOT,
      registry: { activeTurnFor: () => null },
      queue: {
        recordWrites: () => ({}) as PendingChange,
        autoReject: async (): Promise<GitOpResult> => ({ ok: true })
      },
      audit: { log: auditLog },
      isSelfWrite: () => false,
      headSha: () => null,
      commitsBetween: () => [],
      onHealthChange: (state, reason) => healthChanges.push([state, reason]),
      readyTimeoutMs,
      watchFn: (() => fake) as unknown as typeof import('chokidar').watch
    })
    return { watcher, fake, auditLog, healthChanges }
  }

  it('resolves on ready: starting → watching', async () => {
    const h = makeRaceHarness(5_000)
    const startP = h.watcher.start()
    await vi.waitFor(() => expect(h.healthChanges).toContainEqual(['starting', undefined]))
    h.fake.emit('ready')
    await startP
    expect(h.healthChanges).toEqual([
      ['starting', undefined],
      ['watching', undefined]
    ])
    await h.watcher.stop()
    expect(h.healthChanges[2][0]).toBe('stopped')
  })

  it('throws on ready timeout instead of hanging vault init', async () => {
    const h = makeRaceHarness(20)
    await expect(h.watcher.start()).rejects.toThrow(/ready timeout/)
    // Never reached watching; the caller owns the 'down' transition.
    expect(h.healthChanges.map(([s]) => s)).toEqual(['starting'])
    const failure = h.auditLog.mock.calls
      .map((c) => c[0] as AuditEntry)
      .find((e) => e.tool === 'cli-agent:watcher-failure')
    expect(failure?.error).toContain('ready timeout')
  })

  it('throws on a pre-ready chokidar error instead of hanging', async () => {
    const h = makeRaceHarness(5_000)
    const startP = h.watcher.start()
    await vi.waitFor(() => expect(h.healthChanges.length).toBeGreaterThan(0))
    h.fake.emit('error', new Error('EACCES: scan failed'))
    await expect(startP).rejects.toThrow('EACCES: scan failed')
    expect(h.healthChanges.map(([s]) => s)).toEqual(['starting'])
  })

  it('a failed start() can be started again: re-emits starting', async () => {
    const h = makeRaceHarness(5_000)
    const firstStart = h.watcher.start()
    await vi.waitFor(() => expect(h.healthChanges.length).toBeGreaterThan(0))
    h.fake.emit('error', new Error('first scan failed'))
    await expect(firstStart).rejects.toThrow('first scan failed')

    const secondStart = h.watcher.start()
    await vi.waitFor(() =>
      expect(h.healthChanges.filter(([s]) => s === 'starting')).toHaveLength(2)
    )
    h.fake.emit('ready')
    await secondStart
    expect(h.healthChanges.at(-1)).toEqual(['watching', undefined])
    await h.watcher.stop()
  })

  it('a post-ready chokidar error transitions to down and audits (was console-only)', async () => {
    const h = makeRaceHarness(5_000)
    const startP = h.watcher.start()
    await vi.waitFor(() => expect(h.healthChanges.length).toBeGreaterThan(0))
    h.fake.emit('ready')
    await startP

    h.fake.emit('error', new Error('watcher died'))

    expect(h.healthChanges.at(-1)).toEqual(['down', 'watcher error: watcher died'])
    const failure = h.auditLog.mock.calls
      .map((c) => c[0] as AuditEntry)
      .find((e) => e.tool === 'cli-agent:watcher-failure')
    expect(failure?.decision).toBe('error')
    expect(failure?.error).toContain('watcher died')
    await h.watcher.stop()
  })
})

describe('AgentWriteWatcher integration (real chokidar)', () => {
  let root: string | null = null
  let watcher: AgentWriteWatcher | null = null

  afterEach(async () => {
    if (watcher) {
      await watcher.stop()
      watcher = null
    }
    if (root) {
      await rm(root, { recursive: true, force: true })
      root = null
    }
  })

  it('records a real file write and ignores TE_DIR state.json', { timeout: 20_000 }, async () => {
    // realpath: macOS tmpdir is a symlink (/var → /private/var); the watcher
    // relativizes chokidar's resolved paths against root, so root must be real.
    root = await realpath(await mkdtemp(join(tmpdir(), 'agent-write-watcher-')))
    const recordWrites = vi.fn<(opts: RecordWritesOpts) => PendingChange>(
      () => ({}) as PendingChange
    )
    const match: ActiveTurnMatch = {
      ...makeMatch(),
      turn: { ...makeMatch().turn, cwd: root, headShaAtStart: null }
    }
    watcher = new AgentWriteWatcher({
      root,
      registry: { activeTurnFor: () => match },
      queue: {
        recordWrites,
        autoReject: async (): Promise<GitOpResult> => ({ ok: true })
      },
      audit: { log: () => undefined },
      isSelfWrite: () => false,
      headSha: () => null,
      commitsBetween: () => []
    })
    await watcher.start()

    await writeFile(join(root, 'hello.txt'), 'hello agent')
    await vi.waitFor(
      () => {
        const seen = recordWrites.mock.calls.some((c) => c[0].paths.includes('hello.txt'))
        expect(seen).toBe(true)
      },
      // 15s: chokidar event delivery lags under full-suite parallel load
      // (5s flaked in `npm run check` while passing in isolation).
      { timeout: 15_000, interval: 100 }
    )

    await mkdir(join(root, TE_DIR), { recursive: true })
    await writeFile(join(root, TE_DIR, 'state.json'), '{}')
    await new Promise((r) => setTimeout(r, 1000))
    const statePath = `${TE_DIR}/state.json`
    const stateSeen = recordWrites.mock.calls.some((c) => c[0].paths.includes(statePath))
    expect(stateSeen).toBe(false)
  })

  it(
    'recovers when the watcher dies underneath: down → restart → post-recovery writes queued',
    { timeout: 20_000 },
    async () => {
      root = await realpath(await mkdtemp(join(tmpdir(), 'agent-write-watcher-')))
      const recordWrites = vi.fn<(opts: RecordWritesOpts) => PendingChange>(
        () => ({}) as PendingChange
      )
      const auditLog = vi.fn()
      const healthChanges: Array<[string, string | undefined]> = []
      const match: ActiveTurnMatch = {
        ...makeMatch(),
        turn: { ...makeMatch().turn, cwd: root, headShaAtStart: null }
      }
      watcher = new AgentWriteWatcher({
        root,
        registry: { activeTurnFor: () => match },
        queue: {
          recordWrites,
          autoReject: async (): Promise<GitOpResult> => ({ ok: true })
        },
        audit: { log: auditLog },
        isSelfWrite: () => false,
        headSha: () => null,
        commitsBetween: () => [],
        onHealthChange: (state, reason) => healthChanges.push([state, reason])
      })
      await watcher.start()
      expect(healthChanges.map(([s]) => s)).toEqual(['starting', 'watching'])

      // Surface the underlying chokidar instance's death the way a real
      // runtime failure does: an 'error' on the FSWatcher emitter. (Do NOT
      // close() first — chokidar's close removes all listeners and the emit
      // would become an uncaught throw; the restart's teardown closes it.)
      const inner = (watcher as unknown as { watcher: FSWatcher }).watcher
      inner.emit('error', new Error('simulated watcher death'))
      expect(healthChanges.at(-1)?.[0]).toBe('down')
      const failure = auditLog.mock.calls
        .map((c) => c[0] as AuditEntry)
        .find((e) => e.tool === 'cli-agent:watcher-failure')
      expect(failure?.error).toContain('simulated watcher death')

      // Restart (what ipc/git's restartWatcher/backoff drives) and verify
      // post-recovery coverage: a fresh write reaches the queue.
      await watcher.start()
      expect(healthChanges.at(-1)).toEqual(['watching', undefined])

      await writeFile(join(root, 'post-recovery.txt'), 'captured again')
      await vi.waitFor(
        () => {
          const seen = recordWrites.mock.calls.some((c) => c[0].paths.includes('post-recovery.txt'))
          expect(seen).toBe(true)
        },
        { timeout: 15_000, interval: 100 }
      )
    }
  )
})

// ── Step 6 (contracts §5 v1.2.6): per-thread budget thresholds + breaker port ──

describe('budget thresholds and breaker signals (step 6)', () => {
  interface BudgetHarness {
    watcher: AgentWriteWatcher
    recordWrites: ReturnType<typeof vi.fn>
    breaker: {
      noteVelocity: ReturnType<typeof vi.fn>
      noteForbiddenAutoReject: ReturnType<typeof vi.fn>
      noteHeadMoved: ReturnType<typeof vi.fn>
    }
  }

  function makeBudgetHarness(opts: {
    matchFor: () => ActiveTurnMatch | null
    getWriteBudget?: (threadId: string) => number | undefined
    getSlugWriteBudget?: (
      threadId: string
    ) => { slug: string; maxWritesPerMinute: number } | undefined
    headSha?: string | null
  }): BudgetHarness {
    const recordWrites = vi.fn((): PendingChange => ({}) as PendingChange)
    const breaker = {
      noteVelocity: vi.fn(),
      noteForbiddenAutoReject: vi.fn(),
      noteHeadMoved: vi.fn()
    }
    const watcher = new AgentWriteWatcher({
      root: ROOT,
      registry: { activeTurnFor: () => opts.matchFor() },
      queue: {
        recordWrites,
        autoReject: vi.fn(async (): Promise<GitOpResult> => ({ ok: true }))
      },
      audit: { log: vi.fn() },
      isSelfWrite: () => false,
      headSha: () => (opts.headSha === undefined ? 'sha-start' : opts.headSha),
      commitsBetween: () => ['unexplained-sha'],
      getWriteBudget: opts.getWriteBudget,
      getSlugWriteBudget: opts.getSlugWriteBudget,
      breaker
    })
    return { watcher, recordWrites, breaker }
  }

  function matchForThread(threadId: string, concurrent = false): ActiveTurnMatch {
    return makeMatch({
      turn: { ...makeMatch().turn, threadId, turnId: `turn-${threadId}` },
      concurrent
    })
  }

  it('the limiter trips at the HARNESS budget, not the default constant', () => {
    const h = makeBudgetHarness({
      matchFor: () => matchForThread('th1'),
      getWriteBudget: () => 3
    })
    h.watcher.handleBatch([ev('a.ts'), ev('b.ts')])
    expect((h.recordWrites.mock.calls[0][0] as RecordWritesOpts).flags?.highVelocity).toBe(false)
    h.watcher.handleBatch([ev('c.ts')])
    expect((h.recordWrites.mock.calls[1][0] as RecordWritesOpts).flags?.highVelocity).toBe(true)
  })

  it('an undefined budget (unbound/ad-hoc thread) falls back to the default of 10', () => {
    const h = makeBudgetHarness({
      matchFor: () => matchForThread('th1'),
      getWriteBudget: () => undefined
    })
    h.watcher.handleBatch(Array.from({ length: 9 }, (_, i) => ev(`f${i}.ts`)))
    expect((h.recordWrites.mock.calls[0][0] as RecordWritesOpts).flags?.highVelocity).toBe(false)
    h.watcher.handleBatch([ev('f9.ts')])
    expect((h.recordWrites.mock.calls[1][0] as RecordWritesOpts).flags?.highVelocity).toBe(true)
  })

  it('concurrent same-slug threads EACH get the full threshold (per-thread-per-slug, documented)', () => {
    // Two threads bound to the same harness slug: budget 5 each. 4+4 writes
    // (8 > 5 in aggregate) must not flag either thread — the limiter is
    // keyed per thread; per-slug aggregation is Phase 3's loop scheduler.
    let active = matchForThread('th-a')
    const h = makeBudgetHarness({
      matchFor: () => active,
      getWriteBudget: () => 5
    })
    h.watcher.handleBatch(Array.from({ length: 4 }, (_, i) => ev(`a${i}.ts`)))
    active = matchForThread('th-b')
    h.watcher.handleBatch(Array.from({ length: 4 }, (_, i) => ev(`b${i}.ts`)))
    for (const call of h.recordWrites.mock.calls) {
      expect((call[0] as RecordWritesOpts).flags?.highVelocity).toBe(false)
    }
  })

  // ── Phase 3 step 5: opt-in per-(root, slug) aggregate write limiter ──

  it('flags the batch crossing the slug aggregate while every per-thread threshold holds (step 5)', () => {
    // The exact scenario the per-thread golden test above pins as NOT
    // flagging without the field: two same-slug threads, 4+4 writes.
    let active = matchForThread('th-a')
    const h = makeBudgetHarness({
      matchFor: () => active,
      getWriteBudget: () => 10,
      getSlugWriteBudget: () => ({ slug: 'agent-a', maxWritesPerMinute: 5 })
    })
    h.watcher.handleBatch(Array.from({ length: 4 }, (_, i) => ev(`a${i}.ts`)))
    active = matchForThread('th-b')
    h.watcher.handleBatch(Array.from({ length: 4 }, (_, i) => ev(`b${i}.ts`)))
    // First batch: aggregate 4 < 5. Second: aggregate 8 ≥ 5 while each
    // per-thread limiter holds 4 < 10.
    expect((h.recordWrites.mock.calls[0][0] as RecordWritesOpts).flags?.highVelocity).toBe(false)
    expect((h.recordWrites.mock.calls[1][0] as RecordWritesOpts).flags?.highVelocity).toBe(true)
    // Still exactly one velocity observation per attributed batch; the
    // exceeded flag folds both ceilings — same 3-consecutive kill discipline.
    expect(h.breaker.noteVelocity).toHaveBeenCalledTimes(2)
    expect(h.breaker.noteVelocity.mock.calls[0][0]).toMatchObject({ exceeded: false })
    expect(h.breaker.noteVelocity.mock.calls[1][0]).toMatchObject({ exceeded: true })
  })

  it('a degraded-attribution turn still records into the BINDING slug aggregate (v1.3.4 review fix)', () => {
    // Thread B's turn degraded to the adapter identity ('cli-claude') while
    // its binding still names the slug. Keying the limiter by the turn's
    // agentId would shard the pool into two independent allowances; keying
    // by the binding slug (what getSlugWriteBudget now returns) keeps ONE
    // aggregate, so B's 4 writes cross the ceiling A's 4 writes primed.
    let active = matchForThread('th-a')
    const h = makeBudgetHarness({
      matchFor: () => active,
      getWriteBudget: () => 10,
      getSlugWriteBudget: () => ({ slug: 'agent-a', maxWritesPerMinute: 5 })
    })
    h.watcher.handleBatch(Array.from({ length: 4 }, (_, i) => ev(`a${i}.ts`)))
    active = makeMatch({
      turn: {
        ...makeMatch().turn,
        threadId: 'th-b',
        turnId: 'turn-th-b',
        agentId: 'cli-claude'
      },
      attributionSuspect: true
    })
    h.watcher.handleBatch(Array.from({ length: 4 }, (_, i) => ev(`b${i}.ts`)))
    expect((h.recordWrites.mock.calls[0][0] as RecordWritesOpts).flags?.highVelocity).toBe(false)
    expect((h.recordWrites.mock.calls[1][0] as RecordWritesOpts).flags?.highVelocity).toBe(true)
  })

  it('an absent slug budget leaves behavior identical to today: no slug limiter, no aggregate flag', () => {
    // Same 4+4 same-slug traffic with the provider returning undefined
    // (field absent in every existing harness snapshot): nothing flags.
    let active = matchForThread('th-a')
    const h = makeBudgetHarness({
      matchFor: () => active,
      getWriteBudget: () => 5,
      getSlugWriteBudget: () => undefined
    })
    h.watcher.handleBatch(Array.from({ length: 4 }, (_, i) => ev(`a${i}.ts`)))
    active = matchForThread('th-b')
    h.watcher.handleBatch(Array.from({ length: 4 }, (_, i) => ev(`b${i}.ts`)))
    for (const call of h.recordWrites.mock.calls) {
      expect((call[0] as RecordWritesOpts).flags?.highVelocity).toBe(false)
    }
    for (const call of h.breaker.noteVelocity.mock.calls) {
      expect(call[0]).toMatchObject({ exceeded: false })
    }
  })

  it('sends one velocity observation per attributed batch with the exceeded flag', () => {
    const h = makeBudgetHarness({
      matchFor: () => matchForThread('th1'),
      getWriteBudget: () => 2
    })
    h.watcher.handleBatch([ev('a.ts')])
    h.watcher.handleBatch([ev('b.ts')])
    expect(h.breaker.noteVelocity).toHaveBeenCalledTimes(2)
    expect(h.breaker.noteVelocity.mock.calls[0][0]).toMatchObject({
      threadId: 'th1',
      agentId: 'agent-a',
      turnId: 'turn-th1',
      concurrentTurns: false,
      exceeded: false
    })
    expect(h.breaker.noteVelocity.mock.calls[1][0]).toMatchObject({ exceeded: true })
  })

  it('signals forbidden autoRejects to the breaker once per forbidden batch', () => {
    const h = makeBudgetHarness({ matchFor: () => matchForThread('th1') })
    h.watcher.handleBatch([ev(`${TE_DIR}/agents/a/verify.sh`), ev(`${TE_DIR}/agents/a/rules.md`)])
    h.watcher.handleBatch([ev(`${TE_DIR}/agents/a/verify.sh`)])
    expect(h.breaker.noteForbiddenAutoReject).toHaveBeenCalledTimes(2)
    expect(h.breaker.noteForbiddenAutoReject.mock.calls[0][0]).toMatchObject({
      threadId: 'th1',
      turnId: 'turn-th1',
      concurrentTurns: false
    })
  })

  it('signals headMoved to the breaker exactly once per turn, aligned with the audit', () => {
    const h = makeBudgetHarness({
      matchFor: () => matchForThread('th1'),
      headSha: 'sha-other'
    })
    h.watcher.handleBatch([ev('a.ts')])
    h.watcher.handleBatch([ev('b.ts')])
    expect(h.breaker.noteHeadMoved).toHaveBeenCalledTimes(1)
  })

  it('flows the concurrentTurns ambiguity flag into every breaker signal', () => {
    const h = makeBudgetHarness({
      matchFor: () => matchForThread('th1', true),
      headSha: 'sha-other'
    })
    h.watcher.handleBatch([ev('a.ts'), ev(`${TE_DIR}/agents/a/verify.sh`)])
    expect(h.breaker.noteVelocity.mock.calls[0][0]).toMatchObject({ concurrentTurns: true })
    expect(h.breaker.noteForbiddenAutoReject.mock.calls[0][0]).toMatchObject({
      concurrentTurns: true
    })
    expect(h.breaker.noteHeadMoved.mock.calls[0][0]).toMatchObject({ concurrentTurns: true })
  })

  it('kill-then-flush: writes landing after threadClosed become audited-unattributed (§4 trade)', () => {
    // The breaker kill runs spawner.close → registry.threadClosed (zero
    // linger). A write still flushing through awaitWriteFinish arrives with
    // no qualifying window: audited, never queued, never silent.
    const registry = new CliTurnRegistry({
      headSha: () => null,
      isPtyAlive: () => true
    })
    registry.turnStarted({ threadId: 'th1', agentId: 'test-fixer', cwd: ROOT })
    registry.threadClosed('th1')

    const auditLog = vi.fn()
    const recordWrites = vi.fn((): PendingChange => ({}) as PendingChange)
    const watcher = new AgentWriteWatcher({
      root: ROOT,
      registry,
      queue: {
        recordWrites,
        autoReject: vi.fn(async (): Promise<GitOpResult> => ({ ok: true }))
      },
      audit: { log: auditLog },
      isSelfWrite: () => false,
      headSha: () => null,
      commitsBetween: () => []
    })
    watcher.handleBatch([ev('late-flush.ts')])
    expect(recordWrites).not.toHaveBeenCalled()
    expect(auditLog).toHaveBeenCalledTimes(1)
    const entry = auditLog.mock.calls[0][0] as AuditEntry
    expect(entry.tool).toBe('cli-agent:unattributed-write')
    expect(entry.affectedPaths).toEqual(['late-flush.ts'])
  })
})
