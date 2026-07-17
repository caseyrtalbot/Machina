// @vitest-environment node
/**
 * Circuit breaker tests (workstation Phase 2 step 6, contracts §5 v1.2.6;
 * headMoved degraded to the notice-latch class in the v1.2.7 post-merge
 * review hardening): the kill-class trip matrix (velocity / repeated
 * forbidden autoRejects / maxTurns) ⇒ kill EXACTLY ONCE + audit entry +
 * event; headMoved ⇒ notice-latch (a bare HEAD move is indistinguishable
 * from the user's own git activity — never a kill on its own); and the
 * negative rules — never trip on watcher-degraded state alone, never
 * auto-kill on concurrentTurns-flagged signals.
 */
import { describe, it, expect, vi } from 'vitest'
import type { AuditEntry } from '@shared/agent-types'
import type { BreakerTripEvent } from '@shared/agent-breaker-types'
import {
  AgentCircuitBreaker,
  FORBIDDEN_TRIP_PER_TURN,
  VELOCITY_TRIP_CONSECUTIVE,
  type AgentCircuitBreakerDeps
} from '../agent-circuit-breaker'

// The singleton wiring imports electron; tests construct instances directly.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/unused' } }))

interface Harness {
  readonly breaker: AgentCircuitBreaker
  readonly kills: string[]
  readonly auditEntries: AuditEntry[]
  readonly events: BreakerTripEvent[]
}

function makeBreaker(overrides: Partial<AgentCircuitBreakerDeps> = {}): Harness {
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

const SIG = { threadId: 'th1', agentId: 'test-fixer', turnId: 't1', concurrentTurns: false }

describe('AgentCircuitBreaker trip matrix (kill exactly once + audit + event)', () => {
  it('velocity trips after N CONSECUTIVE exceeded batches, never one', () => {
    const h = makeBreaker()
    for (let i = 0; i < VELOCITY_TRIP_CONSECUTIVE - 1; i++) {
      h.breaker.noteVelocity({ ...SIG, exceeded: true })
    }
    expect(h.kills).toEqual([])
    h.breaker.noteVelocity({ ...SIG, exceeded: true })
    expect(h.kills).toEqual(['th1'])
    expect(h.events).toHaveLength(1)
    expect(h.events[0]).toMatchObject({
      threadId: 'th1',
      agentId: 'test-fixer',
      reason: 'velocity',
      action: 'killed'
    })
    expect(h.auditEntries).toHaveLength(1)
    expect(h.auditEntries[0].tool).toBe('cli-agent:breaker-tripped')
    expect(h.auditEntries[0].decision).toBe('denied')
  })

  it('a non-exceeded batch resets the consecutive velocity count', () => {
    const h = makeBreaker()
    for (let i = 0; i < 10; i++) {
      h.breaker.noteVelocity({ ...SIG, exceeded: true })
      h.breaker.noteVelocity({ ...SIG, exceeded: false })
    }
    expect(h.kills).toEqual([])
    expect(h.events).toEqual([])
  })

  it('forbidden-writes trips on REPEATED protected-path autoRejects within one turn', () => {
    const h = makeBreaker()
    for (let i = 0; i < FORBIDDEN_TRIP_PER_TURN - 1; i++) {
      h.breaker.noteForbiddenAutoReject(SIG)
    }
    expect(h.kills).toEqual([])
    h.breaker.noteForbiddenAutoReject(SIG)
    expect(h.kills).toEqual(['th1'])
    expect(h.events[0]).toMatchObject({ reason: 'forbidden-writes', action: 'killed' })
  })

  it('forbidden autoReject counting is per turn — a new turnId restarts it', () => {
    const h = makeBreaker()
    h.breaker.noteForbiddenAutoReject({ ...SIG, turnId: 't1' })
    h.breaker.noteForbiddenAutoReject({ ...SIG, turnId: 't1' })
    h.breaker.noteForbiddenAutoReject({ ...SIG, turnId: 't2' })
    h.breaker.noteForbiddenAutoReject({ ...SIG, turnId: 't2' })
    expect(h.kills).toEqual([])
  })

  it('maxTurns breach trips with the budget in the detail', () => {
    const h = makeBreaker()
    h.breaker.noteMaxTurns({
      threadId: 'th1',
      agentId: 'test-fixer',
      invocationCount: 11,
      maxTurns: 10
    })
    expect(h.kills).toEqual(['th1'])
    expect(h.events[0]).toMatchObject({ reason: 'max-turns', action: 'killed' })
    expect(h.events[0].detail).toContain('11')
    expect(h.events[0].detail).toContain('10')
  })

  it('kills EXACTLY ONCE per episode — further signals after a kill are inert', () => {
    const h = makeBreaker()
    h.breaker.noteMaxTurns({
      threadId: 'th1',
      agentId: 'test-fixer',
      invocationCount: 11,
      maxTurns: 10
    })
    expect(h.kills).toEqual(['th1'])
    h.breaker.noteHeadMoved(SIG)
    for (let i = 0; i < 10; i++) {
      h.breaker.noteVelocity({ ...SIG, exceeded: true })
      h.breaker.noteForbiddenAutoReject(SIG)
    }
    h.breaker.noteMaxTurns({
      threadId: 'th1',
      agentId: 'test-fixer',
      invocationCount: 99,
      maxTurns: 10
    })
    expect(h.kills).toEqual(['th1'])
    expect(h.events).toHaveLength(1)
    expect(h.auditEntries).toHaveLength(1)
  })

  it('a new turn resets the episode: counters and the trip latch', () => {
    const h = makeBreaker()
    h.breaker.noteMaxTurns({
      threadId: 'th1',
      agentId: 'test-fixer',
      invocationCount: 11,
      maxTurns: 10
    })
    expect(h.kills).toEqual(['th1'])
    expect(h.breaker.status().trips).toHaveLength(1)

    h.breaker.noteTurnStarted({ threadId: 'th1', agentId: 'test-fixer' })
    expect(h.breaker.status().trips).toEqual([])

    // A fresh breach in the new episode kills again — once.
    h.breaker.noteMaxTurns({
      threadId: 'th1',
      agentId: 'test-fixer',
      invocationCount: 12,
      maxTurns: 10
    })
    expect(h.kills).toEqual(['th1', 'th1'])
  })

  it('a failed kill still audits and emits (visibility survives the failure)', () => {
    const h = makeBreaker({
      kill: () => {
        throw new Error('spawner gone')
      }
    })
    h.breaker.noteMaxTurns({
      threadId: 'th1',
      agentId: 'test-fixer',
      invocationCount: 11,
      maxTurns: 10
    })
    expect(h.events).toHaveLength(1)
    expect(h.auditEntries).toHaveLength(1)
    expect(h.auditEntries[0].error).toContain('kill failed')
  })

  it('breakers are keyed per thread — one thread tripping never touches another', () => {
    const h = makeBreaker()
    h.breaker.noteMaxTurns({
      threadId: 'th1',
      agentId: 'test-fixer',
      invocationCount: 11,
      maxTurns: 10
    })
    h.breaker.noteVelocity({ ...SIG, threadId: 'th2', turnId: 't9', exceeded: true })
    expect(h.kills).toEqual(['th1'])
    expect(h.breaker.status().trips.map((t) => t.threadId)).toEqual(['th1'])
  })
})

describe('headMoved notice-latch (post-merge review hardening, contracts §8 v1.2.7)', () => {
  it('user git op during a writing turn: a single unexcused HEAD move NEVER kills (single window)', () => {
    // The named negative scenario behind the orchestrator decision: one agent
    // turn is live and writing; the user runs `git commit` / `git pull` /
    // `git checkout` in their own terminal. The next attributed batch computes
    // headMoved=true with concurrentTurns=false (single window, "unambiguous"
    // attribution) — and the breaker must still not kill: a bare HEAD move
    // cannot distinguish user git activity from agent git activity.
    const h = makeBreaker()
    h.breaker.noteHeadMoved(SIG) // concurrentTurns: false — still no kill
    expect(h.kills).toEqual([])
    expect(h.events).toHaveLength(1)
    expect(h.events[0]).toMatchObject({ reason: 'head-moved', action: 'notice' })
    // Audited as an anomaly (nothing was applied), not a denial.
    expect(h.auditEntries[0].decision).toBe('error')
    expect(h.breaker.status().trips).toHaveLength(1)
    expect(h.breaker.status().trips[0].action).toBe('notice')
  })

  it('a headMoved notice escalates to the ONE kill on a later kill-class signal in the same episode', () => {
    const h = makeBreaker()
    h.breaker.noteHeadMoved(SIG)
    expect(h.kills).toEqual([])

    // Same episode, unambiguous kill-class evidence: sustained velocity.
    for (let i = 0; i < VELOCITY_TRIP_CONSECUTIVE; i++) {
      h.breaker.noteVelocity({ ...SIG, exceeded: true })
    }
    expect(h.kills).toEqual(['th1'])
    expect(h.events).toHaveLength(2)
    expect(h.events[1]).toMatchObject({ reason: 'velocity', action: 'killed' })
  })

  it('the audit/flag path survives the degrade: every headMoved notice is audited + broadcast once', () => {
    const h = makeBreaker()
    h.breaker.noteHeadMoved(SIG)
    h.breaker.noteHeadMoved({ ...SIG, turnId: 't1' })
    // Latched: further signals in the episode stay quiet (no notice spam).
    expect(h.events).toHaveLength(1)
    expect(h.auditEntries).toHaveLength(1)
    expect(h.auditEntries[0].tool).toBe('cli-agent:breaker-tripped')
  })
})

describe('noteCost — notice-class, structurally kill-incapable (Phase 3 step 5)', () => {
  it('NEVER kills, at any magnitude/threshold combination', () => {
    const h = makeBreaker()
    const combos = [
      { turnCostUsd: 0.49, cumulativeUsd: 0.49 },
      { turnCostUsd: 10_000, cumulativeUsd: 1_000_000 },
      { turnCostUsd: 10_000, cumulativeUsd: 1_000_000, maxSpendUsd: 0.01 },
      { turnCostUsd: 0.01, cumulativeUsd: 0.02, maxSpendUsd: 0.01 }
    ]
    for (const combo of combos) {
      h.breaker.noteTurnStarted({ threadId: 'th1', agentId: 'test-fixer' })
      h.breaker.noteCost({ threadId: 'th1', agentId: 'test-fixer', ...combo })
    }
    expect(h.kills).toEqual([])
    expect(h.events.every((e) => e.action === 'notice')).toBe(true)
  })

  it('no threshold ⇒ no trip, lastCost recorded (observability only)', () => {
    const h = makeBreaker()
    h.breaker.noteCost({
      threadId: 'th1',
      agentId: 'test-fixer',
      turnCostUsd: 0.49,
      cumulativeUsd: 1.2
    })
    expect(h.events).toEqual([])
    expect(h.auditEntries).toEqual([])
    expect(h.breaker.status().trips).toEqual([])
    expect(h.breaker.lastCostFor('th1')).toEqual({ turnCostUsd: 0.49, cumulativeUsd: 1.2 })
  })

  it('threshold breached ⇒ exactly one max-spend notice per episode (audit decision error)', () => {
    const h = makeBreaker()
    h.breaker.noteCost({
      threadId: 'th1',
      agentId: 'test-fixer',
      turnCostUsd: 1,
      cumulativeUsd: 5,
      maxSpendUsd: 4
    })
    expect(h.kills).toEqual([])
    expect(h.events).toHaveLength(1)
    expect(h.events[0]).toMatchObject({ reason: 'max-spend', action: 'notice' })
    expect(h.events[0].detail).toContain('5')
    expect(h.events[0].detail).toContain('4')
    expect(h.auditEntries[0].decision).toBe('error')

    // Notice-latch dedup within the episode: further breaches stay quiet.
    h.breaker.noteCost({
      threadId: 'th1',
      agentId: 'test-fixer',
      turnCostUsd: 1,
      cumulativeUsd: 6,
      maxSpendUsd: 4
    })
    expect(h.events).toHaveLength(1)
    expect(h.auditEntries).toHaveLength(1)
    // lastCost still tracks the newest observation after the latch.
    expect(h.breaker.lastCostFor('th1')).toEqual({ turnCostUsd: 1, cumulativeUsd: 6 })
  })

  it('a cumulative exactly AT the threshold does not trip (strict >)', () => {
    const h = makeBreaker()
    h.breaker.noteCost({
      threadId: 'th1',
      agentId: 'test-fixer',
      turnCostUsd: 2,
      cumulativeUsd: 4,
      maxSpendUsd: 4
    })
    expect(h.events).toEqual([])
  })

  it('a max-spend notice escalates to the ONE kill on a later kill-class signal', () => {
    const h = makeBreaker()
    h.breaker.noteCost({
      threadId: 'th1',
      agentId: 'test-fixer',
      turnCostUsd: 1,
      cumulativeUsd: 5,
      maxSpendUsd: 4
    })
    expect(h.kills).toEqual([])
    for (let i = 0; i < VELOCITY_TRIP_CONSECUTIVE; i++) {
      h.breaker.noteVelocity({ ...SIG, exceeded: true })
    }
    expect(h.kills).toEqual(['th1'])
    expect(h.events).toHaveLength(2)
    expect(h.events[1]).toMatchObject({ reason: 'velocity', action: 'killed' })
  })

  it('noteTurnStarted wipes lastCost (snapshot, not a counter)', () => {
    const h = makeBreaker()
    h.breaker.noteCost({
      threadId: 'th1',
      agentId: 'test-fixer',
      turnCostUsd: 0.49,
      cumulativeUsd: 0.49
    })
    expect(h.breaker.lastCostFor('th1')).toBeDefined()
    h.breaker.noteTurnStarted({ threadId: 'th1', agentId: 'test-fixer' })
    expect(h.breaker.lastCostFor('th1')).toBeUndefined()
  })
})

describe('noteMaxTurns scope (Phase 3 step 5 slug aggregate)', () => {
  it("scope 'slug' is kill-class max-turns with the slug-aggregate detail, exactly once per episode", () => {
    const h = makeBreaker()
    h.breaker.noteMaxTurns({
      threadId: 'th1',
      agentId: 'test-fixer',
      invocationCount: 6,
      maxTurns: 5,
      scope: 'slug'
    })
    expect(h.kills).toEqual(['th1'])
    expect(h.events[0]).toMatchObject({ reason: 'max-turns', action: 'killed' })
    expect(h.events[0].detail).toContain('slug aggregate')
    expect(h.events[0].detail).toContain('maxTurnsPerSlug')
    expect(h.events[0].detail).toContain('6')
    expect(h.events[0].detail).toContain('5')

    // Same-episode repeat is inert (kill exactly once).
    h.breaker.noteMaxTurns({
      threadId: 'th1',
      agentId: 'test-fixer',
      invocationCount: 7,
      maxTurns: 5,
      scope: 'slug'
    })
    expect(h.kills).toEqual(['th1'])
    expect(h.events).toHaveLength(1)
  })

  it('absent scope behaves byte-identically to the per-thread detail', () => {
    const h = makeBreaker()
    h.breaker.noteMaxTurns({
      threadId: 'th1',
      agentId: 'test-fixer',
      invocationCount: 11,
      maxTurns: 10
    })
    expect(h.events[0].detail).toBe('invocation 11 exceeded the harness maxTurns budget (10)')
    expect(h.events[0].detail).not.toContain('slug')
  })
})

describe('negative rules (contracts §5 v1.2.6)', () => {
  it('NEVER trips on watcher-degraded state alone — health is status honesty, not a trip input', () => {
    const h = makeBreaker({ isSignalSourceHealthy: () => false })
    // Partial counters present, sources degraded, no further positive signal:
    h.breaker.noteVelocity({ ...SIG, exceeded: true })
    expect(h.kills).toEqual([])
    expect(h.events).toEqual([])
    expect(h.breaker.status().trips).toEqual([])
    // The honesty half: status SAYS the signal sources are down.
    expect(h.breaker.status().signalsDegraded).toBe(true)
  })

  it('threshold-reaching signals STILL trip while the source is degraded — health is never a suppressor', () => {
    // Companion positive (v1.2.7 test hardening): the rule is "never trips on
    // degraded state ALONE", not "never trips while degraded". A 'degraded'
    // watcher (e.g. one failed auto-reject) is still DELIVERING signals; a
    // mutation that silences all trips whenever health is false would pass
    // the negative test above and disable containment exactly when it
    // matters. Same signals + unhealthy probe must kill exactly as healthy.
    const h = makeBreaker({ isSignalSourceHealthy: () => false })
    for (let i = 0; i < VELOCITY_TRIP_CONSECUTIVE; i++) {
      h.breaker.noteVelocity({ ...SIG, exceeded: true })
    }
    expect(h.kills).toEqual(['th1'])
    expect(h.events[0]).toMatchObject({ reason: 'velocity', action: 'killed' })
    // Both halves at once: the kill landed AND status stays honest.
    expect(h.breaker.status().signalsDegraded).toBe(true)
  })

  it('status reports signalsDegraded=false when healthy (and defaults healthy unwired)', () => {
    expect(
      makeBreaker({ isSignalSourceHealthy: () => true }).breaker.status().signalsDegraded
    ).toBe(false)
    expect(makeBreaker({ isSignalSourceHealthy: undefined }).breaker.status().signalsDegraded).toBe(
      false
    )
  })

  it('NEVER auto-kills on concurrentTurns-flagged signals — degrades to a notice', () => {
    // Pinned with a KILL-CLASS signal (velocity): headMoved is notice-class
    // regardless since v1.2.7, so it can no longer pin this rule.
    const h = makeBreaker()
    for (let i = 0; i < VELOCITY_TRIP_CONSECUTIVE; i++) {
      h.breaker.noteVelocity({ ...SIG, concurrentTurns: true, exceeded: true })
    }
    expect(h.kills).toEqual([])
    expect(h.events).toHaveLength(1)
    expect(h.events[0]).toMatchObject({ reason: 'velocity', action: 'notice' })
    // Audited as an anomaly (nothing was applied), not a denial.
    expect(h.auditEntries[0].decision).toBe('error')
  })

  it('further ambiguous signals after a notice stay quiet; a kill-class one escalates to ONE kill', () => {
    const h = makeBreaker()
    h.breaker.noteHeadMoved({ ...SIG, concurrentTurns: true })
    h.breaker.noteHeadMoved({ ...SIG, concurrentTurns: true })
    expect(h.events).toHaveLength(1) // no notice spam
    expect(h.kills).toEqual([])

    // headMoved itself can no longer escalate (v1.2.7 notice-latch); the
    // escalation comes from an unambiguous kill-class trip.
    for (let i = 0; i < VELOCITY_TRIP_CONSECUTIVE; i++) {
      h.breaker.noteVelocity({ ...SIG, exceeded: true })
    }
    expect(h.kills).toEqual(['th1'])
    expect(h.events).toHaveLength(2)
    expect(h.events[1].action).toBe('killed')
  })
})
