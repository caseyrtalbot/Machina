// @vitest-environment node
/**
 * Loop-traffic breaker calibration (Phase 3 step 5, Track C — test-only file).
 *
 * Synthetic loop-shaped traffic — fresh thread per firing, zero human pacing —
 * driven against the REAL AgentCircuitBreaker, CliTurnRegistry,
 * checkMaxTurnsOnTurnStarted, WriteRateLimiter, and AgentCostLedger. Nothing
 * here changes production behavior; the suite exists to DOCUMENT observed trip
 * behavior as numbers, which the step-5 DONE block copies as step-6 threshold
 * evidence. The enforcement check runs synchronously inside onTurnStarted
 * (production defers it past the send on a microtask — cadence identical,
 * ordering irrelevant to these counts).
 *
 * Observed numbers (each asserted below; the step-6 calibration table):
 *
 * | # | Loop-shaped scenario                                        | Observed number                          |
 * |---|-------------------------------------------------------------|------------------------------------------|
 * | 1 | 20 firings x 2 exceeded velocity batches each (episode      | 0 velocity trips over 40 exceeded        |
 * |   | reset on every firing)                                      | batches — reset masks cross-firing sustain |
 * | 1 | 3 consecutive exceeded batches within ONE firing            | trip at batch 3 (VELOCITY_TRIP_CONSECUTIVE=3, unchanged) |
 * | 1 | headMoved once per firing, 20 firings                       | 20 notices, 0 kills at any firing count  |
 * | 2 | maxTurns=3, one thread re-fired after each kill, 10 firings | kills on firings 4..10 = 7 kills (every  |
 * |   |                                                             | post-breach firing re-trips; kill never refills) |
 * | 3 | maxTurnsPerSlug=5, fresh thread per firing (the N-firings   | trip at exactly firing 6, on the firing- |
 * |   | ≈ N x budget hole, closed)                                  | 6 thread, with every per-thread count at 1 |
 * | 4 | fresh CliTurnRegistry after 5 same-slug firings             | slug aggregate 5 → 1 (per app run BY     |
 * |   |                                                             | DESIGN; cross-relaunch caps = step-6 loop counters) |
 * | 4 | fresh AgentCostLedger on the same file after $0.50 recorded | spendFor resumes at $0.50 (relaunch never refills money) |
 * | 5 | noteCost breached 3x within one episode                     | exactly 1 'max-spend' notice, 0 kills    |
 * | 5 | noteCost breached once per firing, 20 firings               | 20 notices (one per episode), 0 kills    |
 * | 6 | WriteRateLimiter 10/min, 10-write burst in 1s               | exceeded from write 10 (not 9); window   |
 * |   |                                                             | fully drains 60s after the last write    |
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AuditEntry } from '@shared/agent-types'
import type { BreakerTripEvent } from '@shared/agent-breaker-types'
import type { HarnessBudgets } from '@shared/harness-types'

// The modules under test reach electron/typed-ipc at module scope; only the
// process edges are faked (same mock set as cli-thread-breaker-wiring.test.ts).
vi.mock('electron', () => ({
  app: { getPath: () => join(tmpdir(), 'te-loop-traffic-unused') }
}))
vi.mock('../../../src/main/typed-ipc', () => ({
  typedHandle: vi.fn(),
  typedSend: vi.fn()
}))
vi.mock('../../../src/main/window-registry', () => ({
  getMainWindow: () => null
}))
vi.mock('../../../src/main/ipc/shell', () => ({
  getShellService: () => ({}),
  getCliAgentThreadBridge: () => ({})
}))
vi.mock('../../../src/main/services/audit-logger', () => ({
  AuditLogger: class {
    log = vi.fn()
  }
}))

import {
  AgentCircuitBreaker,
  VELOCITY_TRIP_CONSECUTIVE,
  type AgentCircuitBreakerDeps
} from '../../../src/main/services/agent-circuit-breaker'
import { CliTurnRegistry, type TurnStartedInfo } from '../../../src/main/services/cli-turn-registry'
import { checkMaxTurnsOnTurnStarted } from '../../../src/main/ipc/cli-thread'
import { WriteRateLimiter } from '../../../src/main/services/hitl-gate'
import { AgentCostLedger } from '../../../src/main/services/agent-cost-ledger'

const ROOT = '/ws/loop-root'
const SLUG = 'loop-runner'

interface BreakerHarness {
  readonly breaker: AgentCircuitBreaker
  readonly kills: string[]
  readonly auditEntries: AuditEntry[]
  readonly events: BreakerTripEvent[]
}

function makeBreaker(overrides: Partial<AgentCircuitBreakerDeps> = {}): BreakerHarness {
  const kills: string[] = []
  const auditEntries: AuditEntry[] = []
  const events: BreakerTripEvent[] = []
  const breaker = new AgentCircuitBreaker({
    audit: { log: (entry) => auditEntries.push(entry) },
    kill: (threadId) => kills.push(threadId),
    emit: (event) => events.push(event),
    now: () => 1_700_000_000_000,
    ...overrides
  })
  return { breaker, kills, auditEntries, events }
}

/**
 * Real registry wired to the real enforcement check (the production listener
 * body, minus the microtask deferral). The kill callback mimics production
 * spawner.close semantics: the thread's window drops via threadClosed — which
 * must NOT refill any budget counter.
 */
function makeLoopHarness(budgets: HarnessBudgets | undefined) {
  const infos: TurnStartedInfo[] = []
  const kills: string[] = []
  const registryRef: { current: CliTurnRegistry | null } = { current: null }
  const h = makeBreaker({
    kill: (threadId) => {
      kills.push(threadId)
      registryRef.current?.threadClosed(threadId)
    }
  })
  const registry = new CliTurnRegistry({
    headSha: () => null,
    isPtyAlive: () => true,
    onTurnStarted: (info) => {
      infos.push(info)
      checkMaxTurnsOnTurnStarted(
        info,
        () => (budgets === undefined ? undefined : { slug: SLUG, budgets }),
        h.breaker
      )
    }
  })
  registryRef.current = registry
  return {
    breaker: h.breaker,
    events: h.events,
    auditEntries: h.auditEntries,
    kills,
    registry,
    infos
  }
}

describe('1 — episode reset masks cross-firing sustain (the step-6 velocity calibration hazard)', () => {
  it('20 firings x 2 exceeded batches each = 0 velocity trips (40 exceeded batches total)', () => {
    // A loop fires a fresh turn per iteration; every noteTurnStarted resets
    // the episode counters. Two exceeded batches per firing never reach
    // VELOCITY_TRIP_CONSECUTIVE, so a loop writing at sustained excess speed
    // across firings is INVISIBLE to the velocity breaker. Quantified here as
    // the step-6 hazard: cross-firing sustain needs the loop's own counters.
    const h = makeBreaker()
    for (let firing = 1; firing <= 20; firing++) {
      h.breaker.noteTurnStarted({ threadId: `th-f${firing}`, agentId: SLUG })
      for (let batch = 0; batch < VELOCITY_TRIP_CONSECUTIVE - 1; batch++) {
        h.breaker.noteVelocity({
          threadId: `th-f${firing}`,
          agentId: SLUG,
          turnId: `t${firing}`,
          concurrentTurns: false,
          exceeded: true
        })
      }
    }
    expect(h.kills).toEqual([])
    expect(h.events).toEqual([])
  })

  it('3 consecutive exceeded batches within ONE firing trip at batch 3 (VELOCITY_TRIP_CONSECUTIVE stays 3 — evidence, not a change)', () => {
    expect(VELOCITY_TRIP_CONSECUTIVE).toBe(3)
    const h = makeBreaker()
    h.breaker.noteTurnStarted({ threadId: 'th-f1', agentId: SLUG })
    const sig = { threadId: 'th-f1', agentId: SLUG, turnId: 't1', concurrentTurns: false }
    h.breaker.noteVelocity({ ...sig, exceeded: true })
    h.breaker.noteVelocity({ ...sig, exceeded: true })
    expect(h.kills).toEqual([])
    h.breaker.noteVelocity({ ...sig, exceeded: true })
    expect(h.kills).toEqual(['th-f1'])
    expect(h.events[0]).toMatchObject({ reason: 'velocity', action: 'killed' })
  })

  it('headMoved under re-fires: 20 firings x 1 headMoved each = 20 notices, 0 kills at any firing count', () => {
    // The notice-latch class does not accumulate across firings either: each
    // episode gets its one notice, and no volume of firings escalates a bare
    // HEAD move to a kill.
    const h = makeBreaker()
    for (let firing = 1; firing <= 20; firing++) {
      h.breaker.noteTurnStarted({ threadId: `th-f${firing}`, agentId: SLUG })
      h.breaker.noteHeadMoved({
        threadId: `th-f${firing}`,
        agentId: SLUG,
        turnId: `t${firing}`,
        concurrentTurns: false
      })
    }
    expect(h.kills).toEqual([])
    expect(h.events).toHaveLength(20)
    expect(h.events.every((e) => e.reason === 'head-moved' && e.action === 'notice')).toBe(true)
  })
})

describe('2 — maxTurns re-trip cadence under re-fire-after-kill (one thread)', () => {
  it('maxTurns=3, 10 firings on one thread with a kill+re-fire loop: kills on firings 4..10 = 7 kills', () => {
    // The loop shape: same thread re-fired immediately after each kill (the
    // kill drops the window via threadClosed, which never refills the
    // invocation count). Budget 3 allows exactly firings 1..3; EVERY firing
    // from 4 on re-trips — each noteTurnStarted resets the episode, and the
    // still-breached budget kills again. Re-trip cadence: every post-breach
    // firing, 1 kill each.
    const budgets: HarnessBudgets = { maxTurns: 3, maxWritesPerMinute: 120 }
    const h = makeLoopHarness(budgets)
    const killsAfterFiring: number[] = []
    for (let firing = 1; firing <= 10; firing++) {
      h.registry.turnStarted({ threadId: 'th-loop', agentId: SLUG, cwd: ROOT })
      killsAfterFiring.push(h.kills.length)
    }
    expect(killsAfterFiring).toEqual([0, 0, 0, 1, 2, 3, 4, 5, 6, 7])
    expect(h.kills).toEqual(Array(7).fill('th-loop'))
    expect(h.events.every((e) => e.reason === 'max-turns' && e.action === 'killed')).toBe(true)
    expect(h.events).toHaveLength(7)
  })
})

describe('3 — the N-firings ≈ N x budget hole, closed by maxTurnsPerSlug', () => {
  it('maxTurnsPerSlug=5 under a fresh-thread-per-firing loop: trip at exactly firing 6, every per-thread count at 1', () => {
    // WITHOUT the aggregate, a loop minting a fresh thread per firing gets
    // maxTurns per THREAD — N firings ≈ N x the budget. The slug aggregate
    // closes it: budget 5 allows exactly firings 1..5; firing 6 trips on the
    // breaching thread while every per-thread invocation count sits at 1.
    const budgets: HarnessBudgets = { maxTurns: 100, maxWritesPerMinute: 120, maxTurnsPerSlug: 5 }
    const h = makeLoopHarness(budgets)
    for (let firing = 1; firing <= 6; firing++) {
      h.registry.turnStarted({ threadId: `th-f${firing}`, agentId: SLUG, cwd: ROOT })
    }
    expect(h.kills).toEqual(['th-f6'])
    expect(h.events).toHaveLength(1)
    expect(h.events[0]).toMatchObject({ threadId: 'th-f6', reason: 'max-turns', action: 'killed' })
    expect(h.events[0].detail).toContain('maxTurnsPerSlug')
    expect(h.infos.map((i) => i.invocationCount)).toEqual([1, 1, 1, 1, 1, 1])
    expect(h.infos.map((i) => i.slugInvocationCount)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('a kill between firings does not refill the slug aggregate (threadClosed never resets it)', () => {
    const budgets: HarnessBudgets = { maxTurns: 100, maxWritesPerMinute: 120, maxTurnsPerSlug: 3 }
    const h = makeLoopHarness(budgets)
    h.registry.turnStarted({ threadId: 'th-f1', agentId: SLUG, cwd: ROOT })
    h.registry.turnStarted({ threadId: 'th-f2', agentId: SLUG, cwd: ROOT })
    h.registry.threadClosed('th-f1')
    h.registry.threadClosed('th-f2')
    h.registry.turnStarted({ threadId: 'th-f3', agentId: SLUG, cwd: ROOT })
    expect(h.kills).toEqual([])
    h.registry.turnStarted({ threadId: 'th-f4', agentId: SLUG, cwd: ROOT })
    expect(h.kills).toEqual(['th-f4'])
    expect(h.infos.map((i) => i.slugInvocationCount)).toEqual([1, 2, 3, 4])
  })
})

describe('4 — relaunch semantics, documented as numbers (turns reset BY DESIGN; money never does)', () => {
  let dir: string | null = null

  afterEach(() => {
    if (dir !== null) rmSync(dir, { recursive: true, force: true })
    dir = null
  })

  it('a fresh CliTurnRegistry resets the slug aggregate: 5 firings, relaunch, next firing counts 1', () => {
    // Per-app-run BY DESIGN (per-app-run parity with maxTurns; a relaunch is
    // human re-engagement). Cross-relaunch firing caps are step 6's durable
    // loop counters — this number documents the recorded split.
    const a = makeLoopHarness(undefined)
    for (let firing = 1; firing <= 5; firing++) {
      a.registry.turnStarted({ threadId: `th-f${firing}`, agentId: SLUG, cwd: ROOT })
    }
    expect(a.infos.at(-1)?.slugInvocationCount).toBe(5)

    const b = makeLoopHarness(undefined) // the relaunch
    b.registry.turnStarted({ threadId: 'th-f6', agentId: SLUG, cwd: ROOT })
    expect(b.infos[0].slugInvocationCount).toBe(1)
  })

  it('a fresh AgentCostLedger on the same file resumes spend at $0.50 — relaunch does NOT refill money', async () => {
    dir = mkdtempSync(join(tmpdir(), 'te-loop-traffic-ledger-'))
    const filePath = join(dir, 'agent-cost-ledger.json')

    const a = new AgentCostLedger({ filePath })
    await a.recordSpend(ROOT, SLUG, 0.49)
    await a.recordSpend(ROOT, SLUG, 0.01)
    await a.flush()
    expect(a.spendFor(ROOT, SLUG)).toBeCloseTo(0.5, 10)

    const b = new AgentCostLedger({ filePath }) // the relaunch
    await b.load()
    expect(b.spendFor(ROOT, SLUG)).toBeCloseTo(0.5, 10)
    // Never-observed keys stay undefined — a relaunch cannot mint a $0 floor.
    expect(b.spendFor(ROOT, 'other-slug')).toBeUndefined()
  })
})

describe('5 — noteCost cadence under rapid firings (notice-class, structurally kill-incapable)', () => {
  const costSig = { threadId: 'th-f1', agentId: SLUG }

  it('threshold breached 3x within ONE episode: exactly 1 max-spend notice, 0 kills', () => {
    const h = makeBreaker()
    h.breaker.noteTurnStarted({ threadId: 'th-f1', agentId: SLUG })
    for (let i = 0; i < 3; i++) {
      h.breaker.noteCost({ ...costSig, turnCostUsd: 2, cumulativeUsd: 6 + i, maxSpendUsd: 5 })
    }
    expect(h.kills).toEqual([])
    expect(h.events).toHaveLength(1)
    expect(h.events[0]).toMatchObject({ reason: 'max-spend', action: 'notice' })
    expect(h.auditEntries).toHaveLength(1)
    expect(h.auditEntries[0].decision).toBe('error')
  })

  it('breached once per firing, 20 firings: 20 notices (one per episode), 0 kills at any magnitude', () => {
    const h = makeBreaker()
    for (let firing = 1; firing <= 20; firing++) {
      h.breaker.noteTurnStarted({ threadId: `th-f${firing}`, agentId: SLUG })
      h.breaker.noteCost({
        threadId: `th-f${firing}`,
        agentId: SLUG,
        turnCostUsd: 1000,
        cumulativeUsd: 1000 * firing,
        maxSpendUsd: 5
      })
    }
    expect(h.kills).toEqual([])
    expect(h.events).toHaveLength(20)
    expect(h.events.every((e) => e.reason === 'max-spend' && e.action === 'notice')).toBe(true)
  })
})

describe('6 — WriteRateLimiter 60s sliding window under machine-paced bursts', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('10 writes in 1s at 10/min: exceeded from write 10 (not 9); the window fully drains 60s after the last write', () => {
    vi.useFakeTimers()
    const t0 = 1_700_000_000_000
    vi.setSystemTime(t0 + 1_000)
    const limiter = new WriteRateLimiter()

    // Machine-paced burst: one write every 100ms starting at t0.
    for (let write = 1; write <= 9; write++) {
      limiter.recordAt(t0 + write * 100)
    }
    expect(limiter.isExceeded(10)).toBe(false) // 9 writes in window
    limiter.recordAt(t0 + 1_000)
    expect(limiter.isExceeded(10)).toBe(true) // exceeded from write 10

    // Still exceeded just inside the window of the burst...
    vi.setSystemTime(t0 + 60_000)
    expect(limiter.isExceeded(10)).toBe(true)
    // ...and fully drained once 60s have passed since the LAST write.
    vi.setSystemTime(t0 + 1_000 + 60_000)
    expect(limiter.isExceeded(10)).toBe(false)
  })
})
