import { describe, it, expect, afterEach, vi } from 'vitest'

import { ApprovalQueue, GATE_CONFIRM_TIMEOUT_MS } from '../approval-queue'
import { QueueHitlGate } from '../queue-hitl-gate'
import type { AuditEntry } from '@shared/agent-types'
import type { HitlConfirmOpts } from '../hitl-gate'

interface Harness {
  readonly queue: ApprovalQueue
  readonly audit: AuditEntry[]
  readonly notifications: number[]
}

function makeHarness(): Harness {
  const audit: AuditEntry[] = []
  const notifications: number[] = []
  const queue = new ApprovalQueue({
    git: {
      isRepo: () => true,
      diff: () => '',
      commitApproved: () => ({ ok: true, sha: 'abc123' }),
      discard: async () => ({ ok: true }),
      ignoredUntracked: () => []
    },
    audit: { log: (entry) => audit.push(entry) },
    getRoot: () => '/workspace',
    notify: (pending) => notifications.push(pending)
  })
  return { queue, audit, notifications }
}

const OPTS: HitlConfirmOpts = {
  tool: 'vault.write_file',
  path: 'notes/idea.md',
  description: 'Write 120 bytes'
}

describe('QueueHitlGate', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('delegates to enqueueGateConfirm with its configured timeoutMs', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    const spy = vi.spyOn(h.queue, 'enqueueGateConfirm')
    const gate = new QueueHitlGate(h.queue, 5_000)

    void gate.confirm(OPTS)

    expect(spy).toHaveBeenCalledWith(OPTS, 5_000)
  })

  it('defaults to GATE_CONFIRM_TIMEOUT_MS when no timeout is given', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    const spy = vi.spyOn(h.queue, 'enqueueGateConfirm')
    const gate = new QueueHitlGate(h.queue)

    void gate.confirm(OPTS)

    expect(spy).toHaveBeenCalledWith(OPTS, GATE_CONFIRM_TIMEOUT_MS)
  })

  it('confirm enqueues a gate-confirm PendingChange visible in queue.list()', async () => {
    const h = makeHarness()
    const gate = new QueueHitlGate(h.queue, 30_000)

    const decision = gate.confirm(OPTS)

    const item = h.queue.list()[0]
    expect(item?.kind).toBe('gate-confirm')
    expect(item?.paths).toEqual(['notes/idea.md'])
    expect(item?.agentId).toBe('vault.write_file')
    expect(item?.description).toBe('Write 120 bytes')
    expect(h.notifications).toEqual([1])

    await h.queue.resolve(item?.id ?? '', true)
    await decision // settle before the test exits
  })

  it('resolving with approve=true resolves confirm() as { allowed: true } and removes the item', async () => {
    const h = makeHarness()
    const gate = new QueueHitlGate(h.queue, 30_000)
    const decision = gate.confirm(OPTS)
    const id = h.queue.list()[0]?.id ?? ''

    const result = await h.queue.resolve(id, true)

    expect(result).toEqual({ ok: true })
    await expect(decision).resolves.toMatchObject({ allowed: true })
    expect(h.queue.list()).toEqual([])
  })

  it('resolving with approve=false resolves confirm() as { allowed: false }', async () => {
    const h = makeHarness()
    const gate = new QueueHitlGate(h.queue, 30_000)
    const decision = gate.confirm(OPTS)
    const id = h.queue.list()[0]?.id ?? ''

    await h.queue.resolve(id, false)

    await expect(decision).resolves.toMatchObject({ allowed: false })
    expect(h.queue.list()).toEqual([])
  })

  it('timeout auto-denies AND removes the item from list()', async () => {
    vi.useFakeTimers()
    const h = makeHarness()
    const gate = new QueueHitlGate(h.queue, 50)
    const decision = gate.confirm(OPTS)
    expect(h.queue.list()).toHaveLength(1)

    vi.advanceTimersByTime(50)

    await expect(decision).resolves.toEqual({
      allowed: false,
      reason: 'Denied: approval queue timeout (50ms)'
    })
    expect(h.queue.list()).toEqual([])
  })
})
