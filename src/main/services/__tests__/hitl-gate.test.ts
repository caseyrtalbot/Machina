/**
 * Tests for the HITL (Human-in-the-Loop) gate system.
 *
 * The HITL gate blocks destructive MCP operations until the user
 * confirms via Electron dialog. Tests use injectable mock gates.
 */
import { describe, it, expect } from 'vitest'
import type { HitlGate, HitlDecision } from '../hitl-gate'
import { WriteRateLimiter } from '../hitl-gate'

/** A mock gate that always approves. */
class AlwaysApproveGate implements HitlGate {
  async confirm(): Promise<HitlDecision> {
    return { allowed: true, reason: 'auto-approved for testing' }
  }
}

/** A mock gate that always denies. */
class AlwaysDenyGate implements HitlGate {
  async confirm(): Promise<HitlDecision> {
    return { allowed: false, reason: 'denied for testing' }
  }
}

describe('HitlGate', () => {
  it('returns allowed:true when gate approves', async () => {
    const gate: HitlGate = new AlwaysApproveGate()

    const decision = await gate.confirm({
      tool: 'vault.create_file',
      path: '/vault/test.md',
      description: 'Creating a test file'
    })

    expect(decision.allowed).toBe(true)
    expect(decision.reason).toBe('auto-approved for testing')
  })

  it('returns allowed:false when gate denies', async () => {
    const gate: HitlGate = new AlwaysDenyGate()

    const decision = await gate.confirm({
      tool: 'vault.write_file',
      path: '/vault/test.md',
      description: 'Writing to a file'
    })

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('denied for testing')
  })
})

describe('WriteRateLimiter', () => {
  it('is not exceeded when no writes recorded', () => {
    const limiter = new WriteRateLimiter()
    expect(limiter.isExceeded(10)).toBe(false)
  })

  it('is not exceeded when writes are under the limit', () => {
    const limiter = new WriteRateLimiter()
    for (let i = 0; i < 9; i++) {
      limiter.record()
    }
    expect(limiter.isExceeded(10)).toBe(false)
  })

  it('is exceeded when writes hit the limit', () => {
    const limiter = new WriteRateLimiter()
    for (let i = 0; i < 10; i++) {
      limiter.record()
    }
    expect(limiter.isExceeded(10)).toBe(true)
  })

  it('expires old timestamps beyond the 60s window', () => {
    const limiter = new WriteRateLimiter()
    // Record 10 writes at a time 61 seconds in the past
    const now = Date.now()
    const oldTime = now - 61_000
    for (let i = 0; i < 10; i++) {
      limiter.recordAt(oldTime)
    }
    expect(limiter.isExceeded(10)).toBe(false)
  })
})
