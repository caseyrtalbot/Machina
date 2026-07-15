// @vitest-environment node
// Core ApprovalQueue behaviors. Shared fakes live in approval-queue-harness.ts;
// v1.3.0 scope/persistence + real-git + v1.3.1 delta/hold suites live in
// approval-queue-scope.test.ts (800-line ceiling split).
import { describe, it, expect, afterEach, vi } from 'vitest'

import type { GitOpResult, PendingChange } from '../../src/shared/git-types'
import { GATE_OPTS, makeHarness, mustRecord, recordTurn } from './approval-queue-harness'

// ---------------------------------------------------------------------------
// add / recordWrites / list
// ---------------------------------------------------------------------------

describe('ApprovalQueue add/recordWrites/list', () => {
  it('recordWrites creates one item keyed pc_<turnId> with a diff snapshot', () => {
    const h = makeHarness()
    const change = recordTurn(h)

    expect(change.id).toBe('pc_t1')
    expect(change.kind).toBe('cli-change')
    expect(change.diff).toBe('diff-v1')
    expect(change.revertible).toBe(true)
    expect(h.queue.list()).toEqual([change])
    expect(h.git.diff).toHaveBeenCalledWith('/workspace', ['a.txt'])
  })

  it('coalesces writes for the same turn: paths union, flags OR-merged, single item', () => {
    const h = makeHarness()
    recordTurn(h)
    const merged = mustRecord(
      h.queue.recordWrites({
        turnId: 't1',
        threadId: 'th-1',
        agentId: 'fixer',
        paths: ['a.txt', 'b.txt'],
        flags: { headMoved: true }
      })
    )

    expect(h.queue.list()).toHaveLength(1)
    expect(merged.paths).toEqual(['a.txt', 'b.txt'])
    expect(merged.flags.headMoved).toBe(true)
    expect(merged.flags.highVelocity).toBe(false)
    // Diff snapshot recomputed over the merged set.
    expect(h.git.diff).toHaveBeenLastCalledWith('/workspace', ['a.txt', 'b.txt'])
  })

  it('a tripped flag never untrips on later batches', () => {
    const h = makeHarness()
    h.queue.recordWrites({
      turnId: 't1',
      threadId: 'th-1',
      agentId: 'fixer',
      paths: ['a.txt'],
      flags: { highVelocity: true }
    })
    const merged = mustRecord(
      h.queue.recordWrites({
        turnId: 't1',
        threadId: 'th-1',
        agentId: 'fixer',
        paths: ['a.txt'],
        flags: { highVelocity: false }
      })
    )
    expect(merged.flags.highVelocity).toBe(true)
  })

  it('attributionSuspect OR-merges onto the queue item and never untrips (v1.2.2)', () => {
    // The final link of the suspect chain: the tray chip renders from the
    // QUEUE ITEM's flags, not from the watcher's recordWrites arguments.
    const h = makeHarness()
    h.queue.recordWrites({
      turnId: 't1',
      threadId: 'th-1',
      agentId: 'fixer',
      paths: ['a.txt'],
      flags: { attributionSuspect: true }
    })
    const merged = mustRecord(
      h.queue.recordWrites({
        turnId: 't1',
        threadId: 'th-1',
        agentId: 'fixer',
        paths: ['b.txt']
      })
    )
    expect(merged.flags.attributionSuspect).toBe(true)
    expect(h.queue.list()[0]?.flags.attributionSuspect).toBe(true)
  })

  it('distinct turns produce distinct items', () => {
    const h = makeHarness()
    recordTurn(h, 't1')
    recordTurn(h, 't2')
    expect(h.queue.list().map((c) => c.id)).toEqual(['pc_t1', 'pc_t2'])
  })

  it('add inserts a pre-formed item', () => {
    const h = makeHarness()
    const change = recordTurn(h)
    const other: PendingChange = { ...change, id: 'pc_manual' }
    h.queue.add(other)
    expect(h.queue.list().map((c) => c.id)).toEqual(['pc_t1', 'pc_manual'])
  })

  it('non-repo root records a non-revertible item', () => {
    const h = makeHarness({ isRepo: false })
    expect(recordTurn(h).revertible).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// resolve
// ---------------------------------------------------------------------------

describe('ApprovalQueue resolve', () => {
  it('approve commits via commitApproved and removes the item, with one allowed audit entry', async () => {
    const h = makeHarness()
    recordTurn(h)

    const result = await h.queue.resolve('pc_t1', true, 'fix: apply agent change')

    expect(result).toEqual({ ok: true, sha: 'abc123' })
    expect(h.git.commitApproved).toHaveBeenCalledWith('/workspace', {
      agentId: 'fixer',
      threadId: 'th-1',
      paths: ['a.txt'],
      message: 'fix: apply agent change'
    })
    expect(h.queue.list()).toEqual([])
    expect(h.audit).toHaveLength(1)
    expect(h.audit[0]).toMatchObject({
      tool: 'approvals:resolve',
      decision: 'allowed',
      affectedPaths: ['a.txt'],
      args: { id: 'pc_t1', approve: true, message: 'fix: apply agent change' }
    })
    expect(h.audit[0]?.error).toBeUndefined()
  })

  it('approve without a message falls back to a non-empty default subject', async () => {
    const h = makeHarness()
    recordTurn(h)
    await h.queue.resolve('pc_t1', true)
    const opts = h.git.commitApproved.mock.calls[0]?.[1] as { message: string }
    expect(opts.message.length).toBeGreaterThan(0)
    expect(opts.message).toContain('fixer')
  })

  it('reject discards paths and removes the item, with one denied audit entry', async () => {
    const h = makeHarness()
    recordTurn(h)

    const result = await h.queue.resolve('pc_t1', false)

    expect(result).toEqual({ ok: true })
    expect(h.git.discard).toHaveBeenCalledWith('/workspace', ['a.txt'])
    expect(h.git.commitApproved).not.toHaveBeenCalled()
    expect(h.queue.list()).toEqual([])
    expect(h.audit).toHaveLength(1)
    expect(h.audit[0]).toMatchObject({ tool: 'approvals:resolve', decision: 'denied' })
  })

  it('a failed commit retains the item and audits an error', async () => {
    const h = makeHarness()
    h.git.commitApproved.mockReturnValue({ ok: false, reason: 'git-failed' })
    recordTurn(h)

    const result = await h.queue.resolve('pc_t1', true)

    expect(result).toEqual({ ok: false, reason: 'git-failed' })
    expect(h.queue.list()).toHaveLength(1)
    expect(h.audit[0]).toMatchObject({ decision: 'error', error: 'git-failed' })
  })

  it('stale diff refreshes the item, returns stale-diff, and forces re-review', async () => {
    const h = makeHarness()
    const reviewed = recordTurn(h)
    h.setDiff('diff-v2')

    const result = await h.queue.resolve('pc_t1', true)

    expect(result).toEqual({ ok: false, reason: 'stale-diff' })
    expect(h.git.commitApproved).not.toHaveBeenCalled()
    const refreshed = h.queue.list()[0]
    expect(refreshed?.diff).toBe('diff-v2')
    expect(refreshed?.capturedAt).not.toBe(reviewed.capturedAt)
    expect(h.audit).toHaveLength(1)
    expect(h.audit[0]).toMatchObject({ decision: 'error', error: 'stale-diff' })

    // Diff now matches the refreshed snapshot: re-review succeeds.
    const retry = await h.queue.resolve('pc_t1', true)
    expect(retry.ok).toBe(true)
    expect(h.queue.list()).toEqual([])
    expect(h.audit).toHaveLength(2)
  })

  it('unknown change id returns a structured error with one audit entry', async () => {
    const h = makeHarness()
    const result = await h.queue.resolve('pc_missing', true)
    expect(result).toEqual({ ok: false, reason: 'unknown-change' })
    expect(h.audit).toHaveLength(1)
    expect(h.audit[0]).toMatchObject({
      tool: 'approvals:resolve',
      decision: 'error',
      error: 'unknown-change'
    })
  })

  it('non-repo approve acknowledges with { ok: true }, no commit, item removed', async () => {
    const h = makeHarness({ isRepo: false })
    recordTurn(h)

    const result = await h.queue.resolve('pc_t1', true)

    expect(result).toEqual({ ok: true })
    expect(h.git.commitApproved).not.toHaveBeenCalled()
    expect(h.queue.list()).toEqual([])
    expect(h.audit[0]).toMatchObject({ decision: 'allowed' })
  })

  it('non-repo reject returns not-a-git-repo and RETAINS the item', async () => {
    const h = makeHarness({ isRepo: false })
    recordTurn(h)

    const result = await h.queue.resolve('pc_t1', false)

    expect(result).toEqual({ ok: false, reason: 'not-a-git-repo' })
    expect(h.git.discard).not.toHaveBeenCalled()
    expect(h.queue.list()).toHaveLength(1)
    expect(h.audit[0]).toMatchObject({ decision: 'error', error: 'not-a-git-repo' })
  })

  it('no workspace root returns a structured error', async () => {
    const h = makeHarness({ root: null })
    recordTurn(h)
    const result = await h.queue.resolve('pc_t1', true)
    expect(result).toEqual({ ok: false, reason: 'no-workspace' })
  })

  it('a workspace switch between capture and resolve returns workspace-changed and retains the item', async () => {
    const h = makeHarness()
    recordTurn(h) // captured against /workspace
    h.setRoot('/other-workspace')

    for (const approve of [true, false]) {
      const result = await h.queue.resolve('pc_t1', approve)
      expect(result).toEqual({ ok: false, reason: 'workspace-changed' })
    }

    // Neither git mutation ran against the wrong root; no diff refresh either.
    expect(h.git.commitApproved).not.toHaveBeenCalled()
    expect(h.git.discard).not.toHaveBeenCalled()
    expect(h.git.diff).toHaveBeenCalledTimes(1) // capture-time snapshot only
    expect(h.queue.list()).toHaveLength(1)
    expect(h.audit[0]).toMatchObject({ decision: 'error', error: 'workspace-changed' })

    // Switching back to the captured workspace unblocks the resolve.
    h.setRoot('/workspace')
    const result = await h.queue.resolve('pc_t1', true)
    expect(result.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// gate-confirm
// ---------------------------------------------------------------------------

describe('ApprovalQueue enqueueGateConfirm', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('queues a gate-confirm item and resolves the decision on approve', async () => {
    const h = makeHarness()
    const decision = h.queue.enqueueGateConfirm(GATE_OPTS, 30_000)

    const item = h.queue.list()[0]
    expect(item?.kind).toBe('gate-confirm')
    expect(item?.paths).toEqual(['notes/idea.md'])

    const result = await h.queue.resolve(item?.id ?? '', true)
    expect(result).toEqual({ ok: true })
    await expect(decision).resolves.toMatchObject({ allowed: true })
    expect(h.queue.list()).toEqual([])
    expect(h.audit).toHaveLength(1)
    expect(h.audit[0]).toMatchObject({ tool: 'approvals:resolve', decision: 'allowed' })
    expect(h.git.commitApproved).not.toHaveBeenCalled()
  })

  it('reject resolves the decision as denied and removes the item', async () => {
    const h = makeHarness()
    const decision = h.queue.enqueueGateConfirm(GATE_OPTS, 30_000)
    const id = h.queue.list()[0]?.id ?? ''

    await h.queue.resolve(id, false)
    await expect(decision).resolves.toMatchObject({ allowed: false })
    expect(h.queue.list()).toEqual([])
    expect(h.audit[0]).toMatchObject({ decision: 'denied' })
  })

  it('timeout auto-denies AND removes the item', async () => {
    vi.useFakeTimers()
    const h = makeHarness()
    const decision = h.queue.enqueueGateConfirm(GATE_OPTS, 30_000)
    expect(h.queue.list()).toHaveLength(1)

    vi.advanceTimersByTime(30_000)

    await expect(decision).resolves.toEqual({
      allowed: false,
      reason: 'Approval queue timeout (30000ms)'
    })
    expect(h.queue.list()).toEqual([])
    // A late resolve of the timed-out id is an unknown change, not a decision.
    const late = await h.queue.resolve('gc_1', true)
    expect(late).toEqual({ ok: false, reason: 'unknown-change' })
  })

  it('a resolved gate-confirm does not auto-deny when the timeout later fires', async () => {
    vi.useFakeTimers()
    const h = makeHarness()
    const decision = h.queue.enqueueGateConfirm(GATE_OPTS, 30_000)
    const id = h.queue.list()[0]?.id ?? ''

    await h.queue.resolve(id, true)
    vi.advanceTimersByTime(60_000)

    await expect(decision).resolves.toMatchObject({ allowed: true })
  })
})

// ---------------------------------------------------------------------------
// notify
// ---------------------------------------------------------------------------

describe('ApprovalQueue notify', () => {
  it('fires with the pending count on every queue mutation', async () => {
    const h = makeHarness()

    recordTurn(h, 't1') // create → 1
    recordTurn(h, 't1') // coalesce (item replaced) → 1
    recordTurn(h, 't2') // second item → 2

    h.setDiff('diff-v2')
    await h.queue.resolve('pc_t1', true) // stale refresh → 2
    await h.queue.resolve('pc_t1', true) // approve removes → 1
    await h.queue.resolve('pc_t2', false) // stale refresh (recorded at diff-v1) → 1
    await h.queue.resolve('pc_t2', false) // reject removes → 0

    expect(h.notifications).toEqual([1, 1, 2, 2, 1, 1, 0])
  })

  it('does not fire on a no-mutation resolve (unknown id)', async () => {
    const h = makeHarness()
    await h.queue.resolve('pc_missing', true)
    expect(h.notifications).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// autoReject
// ---------------------------------------------------------------------------

describe('ApprovalQueue autoReject', () => {
  it('repo: discards ONLY the forbidden paths, keeps them out of the queue, audits denied', async () => {
    const h = makeHarness()
    // Legitimate writes for the same turn already await review.
    recordTurn(h)

    const result = await h.queue.autoReject({
      turnId: 't1',
      threadId: 'th-1',
      agentId: 'fixer',
      paths: ['.claude/settings.json']
    })

    expect(result).toEqual({ ok: true })
    expect(h.git.discard).toHaveBeenCalledTimes(1)
    expect(h.git.discard).toHaveBeenCalledWith('/workspace', ['.claude/settings.json'])
    // The forbidden paths do NOT land in the queue; the legit item is untouched.
    expect(h.queue.list()).toHaveLength(1)
    expect(h.queue.list()[0]?.paths).toEqual(['a.txt'])
    expect(h.queue.list()[0]?.flags.forbidden).toBe(false)
    expect(h.audit).toHaveLength(1)
    expect(h.audit[0]).toMatchObject({
      tool: 'approvals:auto-reject',
      decision: 'denied',
      affectedPaths: ['.claude/settings.json'],
      args: { turnId: 't1', threadId: 'th-1', agentId: 'fixer' }
    })
    expect(h.audit[0]?.error).toBeUndefined()
  })

  it('discard failure: paths merge into the turn item flagged forbidden, audit is error', async () => {
    const h = makeHarness()
    h.git.discard.mockResolvedValue({ ok: false, reason: 'discard-failed' })
    // Pre-existing attributed writes with a tripped flag: the merge must not clobber them.
    h.queue.recordWrites({
      turnId: 't1',
      threadId: 'th-1',
      agentId: 'fixer',
      paths: ['a.txt'],
      flags: { highVelocity: true }
    })

    const result = await h.queue.autoReject({
      turnId: 't1',
      threadId: 'th-1',
      agentId: 'fixer',
      paths: ['secret.env']
    })

    expect(result).toEqual({ ok: false, reason: 'discard-failed' })
    const item = h.queue.list()[0]
    expect(h.queue.list()).toHaveLength(1) // coalesced into pc_t1, not a new item
    expect(item?.id).toBe('pc_t1')
    expect(item?.paths).toEqual(['a.txt', 'secret.env'])
    expect(item?.flags.forbidden).toBe(true)
    expect(item?.flags.highVelocity).toBe(true) // prior flag survives the merge
    // Diff is the standard recordWrites recompute over the merged set — no clobber beyond that.
    expect(h.git.diff).toHaveBeenLastCalledWith('/workspace', ['a.txt', 'secret.env'])
    expect(item?.diff).toBe('diff-v1')
    expect(h.audit[0]).toMatchObject({
      tool: 'approvals:auto-reject',
      decision: 'error',
      error: 'discard-failed',
      affectedPaths: ['secret.env']
    })
  })

  it('non-repo: no discard, item retained flagged forbidden, result not-a-git-repo', async () => {
    const h = makeHarness({ isRepo: false })

    const result = await h.queue.autoReject({
      turnId: 't1',
      threadId: 'th-1',
      agentId: 'fixer',
      paths: ['secret.env']
    })

    expect(result).toEqual({ ok: false, reason: 'not-a-git-repo' })
    expect(h.git.discard).not.toHaveBeenCalled()
    const item = h.queue.list()[0]
    expect(item?.id).toBe('pc_t1')
    expect(item?.paths).toEqual(['secret.env'])
    expect(item?.flags.forbidden).toBe(true)
    expect(h.audit[0]).toMatchObject({
      tool: 'approvals:auto-reject',
      decision: 'error',
      error: 'not-a-git-repo'
    })
  })

  it('expectedRoot mismatch: no discard, no item, audit error workspace-changed', async () => {
    const h = makeHarness() // getRoot() → /workspace

    const result = await h.queue.autoReject(
      {
        turnId: 't1',
        threadId: 'th-1',
        agentId: 'fixer',
        paths: ['secret.env']
      },
      '/old-workspace'
    )

    expect(result).toEqual({ ok: false, reason: 'workspace-changed' })
    expect(h.git.discard).not.toHaveBeenCalled()
    expect(h.queue.list()).toEqual([])
    expect(h.audit).toHaveLength(1)
    expect(h.audit[0]).toMatchObject({
      tool: 'approvals:auto-reject',
      decision: 'error',
      error: 'workspace-changed',
      affectedPaths: ['secret.env']
    })
  })

  it('discard failure after a mid-await workspace switch: the fallback item binds to the ENTRY root', async () => {
    const h = makeHarness() // entry root: /workspace
    // The switch completes while discard() is awaited, then discard fails:
    // the visibility fallback must record old-root paths against the entry
    // root, never the new active one (v1.3.0 root-binding race).
    h.git.discard.mockImplementation(async (): Promise<GitOpResult> => {
      h.setRoot('/new-workspace')
      return { ok: false, reason: 'discard-failed' }
    })

    const result = await h.queue.autoReject(
      { turnId: 't1', threadId: 'th-1', agentId: 'fixer', paths: ['secret.env'] },
      '/workspace'
    )

    expect(result).toEqual({ ok: false, reason: 'discard-failed' })
    const item = h.queue.list()[0]
    expect(item?.capturedRoot).toBe('/workspace')
    expect(item?.flags.forbidden).toBe(true)
    expect(h.git.diff).toHaveBeenLastCalledWith('/workspace', ['secret.env'])
  })
})

// ---------------------------------------------------------------------------
// approve around ignored-untracked paths
// ---------------------------------------------------------------------------

describe('ApprovalQueue approve with ignored-untracked paths', () => {
  it('commits around ignored-untracked paths and removes the item', async () => {
    const h = makeHarness()
    h.setIgnoredUntracked(['.env'])
    h.queue.recordWrites({
      turnId: 't1',
      threadId: 'th-1',
      agentId: 'fixer',
      paths: ['src/a.ts', '.env']
    })

    const result = await h.queue.resolve('pc_t1', true)

    expect(result).toEqual({ ok: true, sha: 'abc123' })
    expect(h.git.ignoredUntracked).toHaveBeenCalledWith('/workspace', ['src/a.ts', '.env'])
    expect(h.git.commitApproved).toHaveBeenCalledTimes(1)
    const opts = h.git.commitApproved.mock.calls[0]?.[1] as { paths: readonly string[] }
    expect(opts.paths).toEqual(['src/a.ts'])
    expect(h.queue.list()).toEqual([])
  })

  it('all paths ignored-untracked: approve acknowledges without a commit', async () => {
    const h = makeHarness()
    h.setIgnoredUntracked(['.env', 'secrets/.env.local'])
    h.queue.recordWrites({
      turnId: 't1',
      threadId: 'th-1',
      agentId: 'fixer',
      paths: ['.env', 'secrets/.env.local']
    })

    const result = await h.queue.resolve('pc_t1', true)

    expect(result).toEqual({ ok: true })
    expect(h.git.commitApproved).not.toHaveBeenCalled()
    expect(h.queue.list()).toEqual([])
    expect(h.audit).toHaveLength(1)
    expect(h.audit[0]).toMatchObject({ tool: 'approvals:resolve', decision: 'allowed' })
  })
})

// ---------------------------------------------------------------------------
// flagExisting
// ---------------------------------------------------------------------------

describe('ApprovalQueue flagExisting', () => {
  it('OR-merges flags into an existing turn item without touching paths/diff', () => {
    const h = makeHarness()
    const recorded = mustRecord(
      h.queue.recordWrites({
        turnId: 't9',
        threadId: 'th-1',
        agentId: 'fixer',
        paths: ['a.txt']
      })
    )
    const notifiesBefore = h.notifications.length

    const flagged = h.queue.flagExisting('t9', { headMoved: true })

    expect(flagged).toBe(true)
    const item = h.queue.list()[0]
    expect(item?.id).toBe('pc_t9')
    expect(item?.flags.headMoved).toBe(true)
    expect(item?.paths).toEqual(recorded.paths)
    expect(item?.diff).toBe(recorded.diff)
    expect(h.notifications.length).toBe(notifiesBefore + 1)
  })

  it('unknown turn returns false and adds no item', () => {
    const h = makeHarness()
    const flagged = h.queue.flagExisting('t-unknown', { headMoved: true })
    expect(flagged).toBe(false)
    expect(h.queue.list()).toEqual([])
    expect(h.notifications).toEqual([])
  })
})
