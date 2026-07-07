// @vitest-environment node
/**
 * Circuit breaker tests (workstation Phase 2 step 6, contracts §5 v1.2.6):
 * the trip matrix (velocity / repeated forbidden autoRejects / headMoved /
 * maxTurns) ⇒ kill EXACTLY ONCE + audit entry + event, and the two negative
 * rules — never trip on watcher-degraded state alone, never auto-kill on
 * concurrentTurns-flagged signals.
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

  it('headMoved trips on the first signal', () => {
    const h = makeBreaker()
    h.breaker.noteHeadMoved(SIG)
    expect(h.kills).toEqual(['th1'])
    expect(h.events[0]).toMatchObject({ reason: 'head-moved', action: 'killed' })
    expect(h.auditEntries[0].decision).toBe('denied')
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
    h.breaker.noteHeadMoved(SIG)
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
    h.breaker.noteHeadMoved(SIG)
    expect(h.kills).toEqual(['th1'])
    expect(h.breaker.status().trips).toHaveLength(1)

    h.breaker.noteTurnStarted({ threadId: 'th1', agentId: 'test-fixer' })
    expect(h.breaker.status().trips).toEqual([])

    // A fresh runaway in the new episode kills again — once.
    h.breaker.noteHeadMoved({ ...SIG, turnId: 't2' })
    expect(h.kills).toEqual(['th1', 'th1'])
  })

  it('a failed kill still audits and emits (visibility survives the failure)', () => {
    const h = makeBreaker({
      kill: () => {
        throw new Error('spawner gone')
      }
    })
    h.breaker.noteHeadMoved(SIG)
    expect(h.events).toHaveLength(1)
    expect(h.auditEntries).toHaveLength(1)
    expect(h.auditEntries[0].error).toContain('kill failed')
  })

  it('breakers are keyed per thread — one thread tripping never touches another', () => {
    const h = makeBreaker()
    h.breaker.noteHeadMoved(SIG)
    h.breaker.noteVelocity({ ...SIG, threadId: 'th2', turnId: 't9', exceeded: true })
    expect(h.kills).toEqual(['th1'])
    expect(h.breaker.status().trips.map((t) => t.threadId)).toEqual(['th1'])
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

  it('status reports signalsDegraded=false when healthy (and defaults healthy unwired)', () => {
    expect(
      makeBreaker({ isSignalSourceHealthy: () => true }).breaker.status().signalsDegraded
    ).toBe(false)
    expect(makeBreaker({ isSignalSourceHealthy: undefined }).breaker.status().signalsDegraded).toBe(
      false
    )
  })

  it('NEVER auto-kills on concurrentTurns-flagged signals — degrades to a notice', () => {
    const h = makeBreaker()
    h.breaker.noteHeadMoved({ ...SIG, concurrentTurns: true })
    expect(h.kills).toEqual([])
    expect(h.events).toHaveLength(1)
    expect(h.events[0]).toMatchObject({ reason: 'head-moved', action: 'notice' })
    // Audited as an anomaly (nothing was applied), not a denial.
    expect(h.auditEntries[0].decision).toBe('error')
  })

  it('further ambiguous signals after a notice stay quiet; an unambiguous one escalates to ONE kill', () => {
    const h = makeBreaker()
    h.breaker.noteHeadMoved({ ...SIG, concurrentTurns: true })
    h.breaker.noteHeadMoved({ ...SIG, concurrentTurns: true })
    expect(h.events).toHaveLength(1) // no notice spam
    expect(h.kills).toEqual([])

    h.breaker.noteHeadMoved({ ...SIG, concurrentTurns: false })
    expect(h.kills).toEqual(['th1'])
    expect(h.events).toHaveLength(2)
    expect(h.events[1].action).toBe('killed')
  })
})
