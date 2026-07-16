// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearSession, markBlockSeen, waitForFirstBlock } from '../shell-readiness'

// Module state (seen set + waiter map) persists across tests, so every test
// uses its own sessionId — no cross-test reset needed.

describe('shell-readiness (workstation Phase 3 step 4)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves true immediately when the block arrived before the waiter registered', async () => {
    markBlockSeen('sess-pre-seen')
    await expect(waitForFirstBlock('sess-pre-seen')).resolves.toBe(true)
  })

  it('resolves true when markBlockSeen fires after the waiter registered', async () => {
    const pending = waitForFirstBlock('sess-late-block')
    markBlockSeen('sess-late-block')
    await expect(pending).resolves.toBe(true)
  })

  it('resolves false at the default 10s timeout and cleans the waiter up', async () => {
    vi.useFakeTimers()
    let settled: boolean | undefined
    void waitForFirstBlock('sess-timeout').then((ready) => {
      settled = ready
    })
    await vi.advanceTimersByTimeAsync(9_999)
    expect(settled).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(false)
    // The timed-out waiter is gone: a block arriving later readies the
    // session for NEW waiters without touching the settled one.
    markBlockSeen('sess-timeout')
    await expect(waitForFirstBlock('sess-timeout')).resolves.toBe(true)
    expect(settled).toBe(false)
  })

  it('resolves false when the session exits while waiting (clearSession)', async () => {
    const pending = waitForFirstBlock('sess-exits')
    clearSession('sess-exits')
    await expect(pending).resolves.toBe(false)
  })

  it('clearSession forgets a seen session: the respawned id must produce its own block', async () => {
    vi.useFakeTimers()
    markBlockSeen('sess-recycled')
    clearSession('sess-recycled')
    let settled: boolean | undefined
    void waitForFirstBlock('sess-recycled').then((ready) => {
      settled = ready
    })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(settled).toBe(false)
  })

  it('settles multiple concurrent waiters exactly once each', async () => {
    const a = waitForFirstBlock('sess-multi')
    const b = waitForFirstBlock('sess-multi')
    markBlockSeen('sess-multi')
    await expect(a).resolves.toBe(true)
    await expect(b).resolves.toBe(true)
  })

  it('a resolved waiter is not re-settled by its timeout firing later', async () => {
    vi.useFakeTimers()
    const resolutions: boolean[] = []
    void waitForFirstBlock('sess-cleared-timer').then((ready) => {
      resolutions.push(ready)
    })
    markBlockSeen('sess-cleared-timer')
    await vi.advanceTimersByTimeAsync(20_000)
    expect(resolutions).toEqual([true])
  })

  it('respects an explicit timeoutMs shorter than the default', async () => {
    vi.useFakeTimers()
    let settled: boolean | undefined
    void waitForFirstBlock('sess-short', 500).then((ready) => {
      settled = ready
    })
    await vi.advanceTimersByTimeAsync(500)
    expect(settled).toBe(false)
  })
})
