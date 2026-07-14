// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { ApprovalQueue } from '../../src/main/services/approval-queue'
import type { ApprovalQueueGitDeps } from '../../src/main/services/approval-queue'
import type { HitlConfirmOpts } from '../../src/main/services/hitl-gate'
import type { AuditEntry } from '../../src/shared/agent-types'
import type { GitOpResult, PendingChange } from '../../src/shared/git-types'
import {
  isGitRepo,
  diff as gitDiff,
  commitApproved,
  discard as gitDiscard,
  ignoredUntracked
} from '../../src/main/services/git-service'

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface Harness {
  readonly queue: ApprovalQueue
  readonly audit: AuditEntry[]
  readonly notifications: number[]
  /** Every persist-hook snapshot, in mutation order (cli-change items only). */
  readonly persisted: PendingChange[][]
  readonly git: {
    isRepo: ReturnType<typeof vi.fn>
    diff: ReturnType<typeof vi.fn>
    commitApproved: ReturnType<typeof vi.fn>
    discard: ReturnType<typeof vi.fn>
    ignoredUntracked: ReturnType<typeof vi.fn>
  }
  setDiff(next: string): void
  setRoot(next: string | null): void
  setIgnoredUntracked(next: readonly string[]): void
}

function makeHarness(opts: { isRepo?: boolean; root?: string | null } = {}): Harness {
  const audit: AuditEntry[] = []
  const notifications: number[] = []
  const persisted: PendingChange[][] = []
  let diffValue = 'diff-v1'
  let rootValue = opts.root !== undefined ? opts.root : '/workspace'
  let tick = 0
  let ignoredValue: readonly string[] = []
  const git = {
    isRepo: vi.fn((): boolean => opts.isRepo ?? true),
    diff: vi.fn((): string => diffValue),
    commitApproved: vi.fn((): GitOpResult => ({ ok: true, sha: 'abc123' })),
    discard: vi.fn(async (): Promise<GitOpResult> => ({ ok: true })),
    ignoredUntracked: vi.fn((): readonly string[] => ignoredValue)
  }
  const queue = new ApprovalQueue({
    git,
    audit: { log: (entry) => audit.push(entry) },
    getRoot: () => rootValue,
    notify: (pending) => notifications.push(pending),
    persist: (items) => persisted.push([...items]),
    now: () => new Date(1751000000000 + tick++ * 1000).toISOString()
  })
  return {
    queue,
    audit,
    notifications,
    persisted,
    git,
    setDiff: (next) => {
      diffValue = next
    },
    setRoot: (next) => {
      rootValue = next
    },
    setIgnoredUntracked: (next) => {
      ignoredValue = next
    }
  }
}

/** recordWrites returns null only on the captured-root coalesce refusal (v1.3.0). */
function mustRecord(change: PendingChange | null): PendingChange {
  if (change === null) throw new Error('recordWrites refused the batch')
  return change
}

function recordTurn(h: Harness, turnId = 't1'): PendingChange {
  return mustRecord(
    h.queue.recordWrites({
      turnId,
      threadId: 'th-1',
      agentId: 'fixer',
      paths: ['a.txt']
    })
  )
}

const GATE_OPTS: HitlConfirmOpts = {
  tool: 'vault.write_file',
  path: 'notes/idea.md',
  description: 'Write 120 bytes'
}

const NO_FLAGS = {
  highVelocity: false,
  headMoved: false,
  concurrentTurns: false,
  degradedAttribution: false,
  gateDegraded: false,
  attributionSuspect: false,
  forbidden: false
} as const

/** A persisted cli-change item as the disk mirror would hand it to rehydrate. */
function persistedItem(overrides: Partial<PendingChange> = {}): PendingChange {
  return {
    id: 'pc_r1',
    kind: 'cli-change',
    threadId: 'th-1',
    agentId: 'fixer',
    paths: ['a.txt'],
    diff: 'diff-v1',
    capturedAt: '2026-07-14T00:00:00.000Z',
    revertible: true,
    flags: NO_FLAGS,
    capturedRoot: '/workspace',
    ...overrides
  }
}

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
      reason: 'Denied: approval queue timeout (30000ms)'
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

// ---------------------------------------------------------------------------
// capturedRoot payload + persist hook (v1.3.0)
// ---------------------------------------------------------------------------

describe('ApprovalQueue capturedRoot payload + persist snapshots (v1.3.0)', () => {
  it('cli-change items carry the root they were captured against', () => {
    const h = makeHarness()
    const change = recordTurn(h)
    expect(change.capturedRoot).toBe('/workspace')
    expect(h.queue.list()[0]?.capturedRoot).toBe('/workspace')
  })

  it('add() stamps capturedRoot from the active root', () => {
    const h = makeHarness()
    const change = recordTurn(h)
    h.setRoot('/other-workspace')
    h.queue.add({ ...change, id: 'pc_manual' })
    const added = h.queue.list().find((i) => i.id === 'pc_manual')
    expect(added?.capturedRoot).toBe('/other-workspace')
  })

  it('persist fires on every mutation with cli-change items only', async () => {
    const h = makeHarness()
    recordTurn(h)
    void h.queue.enqueueGateConfirm(GATE_OPTS, 30_000)
    expect(h.queue.list()).toHaveLength(2)
    // The gate-confirm mutation persisted, but its snapshot excludes the confirm.
    expect(h.persisted.at(-1)?.map((i) => i.id)).toEqual(['pc_t1'])

    await h.queue.resolve('pc_t1', true)
    expect(h.persisted.at(-1)).toEqual([]) // resolved item left the mirror
  })

  it('gate-confirm items are NEVER serialized across their whole lifecycle', async () => {
    const h = makeHarness()
    const decision = h.queue.enqueueGateConfirm(GATE_OPTS, 30_000)
    const id = h.queue.list()[0]?.id ?? ''
    await h.queue.resolve(id, true)
    await decision
    expect(h.persisted.length).toBeGreaterThan(0)
    for (const snapshot of h.persisted) {
      expect(snapshot.every((i) => i.kind === 'cli-change')).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// recordWrites root binding (v1.3.0)
// ---------------------------------------------------------------------------

describe('ApprovalQueue recordWrites root binding (v1.3.0)', () => {
  it('binds to the caller-captured root when the active workspace flipped mid-flush', async () => {
    // Workspace-switch race: the OLD root's watcher flushes a batch AFTER
    // WorkspaceService flipped the active root. The item must bind to the
    // watcher's root — the paths and diff belong to that tree.
    const h = makeHarness()
    h.setRoot('/new-workspace') // the switch already happened
    const change = mustRecord(
      h.queue.recordWrites({
        turnId: 't1',
        threadId: 'th-1',
        agentId: 'fixer',
        paths: ['a.txt'],
        capturedRoot: '/workspace'
      })
    )

    expect(change.capturedRoot).toBe('/workspace')
    expect(h.git.diff).toHaveBeenCalledWith('/workspace', ['a.txt']) // never the new root
    // Resolution stays root-bound: refused from the new workspace…
    const refused = await h.queue.resolve('pc_t1', false)
    expect(refused).toEqual({ ok: false, reason: 'workspace-changed' })
    // …and honored back in the captured one.
    h.setRoot('/workspace')
    const resolved = await h.queue.resolve('pc_t1', false)
    expect(resolved).toEqual({ ok: true })
  })

  it('a later same-id batch cannot flip an existing item to the new active root', () => {
    const h = makeHarness()
    recordTurn(h) // pc_t1 bound to /workspace
    h.setRoot('/new-workspace')
    const refused = h.queue.recordWrites({
      turnId: 't1',
      threadId: 'th-1',
      agentId: 'fixer',
      paths: ['b.txt'] // no capturedRoot: the getRoot() fallback path
    })

    expect(refused).toBeNull()
    const item = h.queue.list()[0]
    expect(item?.capturedRoot).toBe('/workspace') // unchanged
    expect(item?.paths).toEqual(['a.txt']) // no cross-root path union
    expect(h.audit.at(-1)).toMatchObject({
      tool: 'approvals:record-refused',
      decision: 'error',
      error: 'captured-root-mismatch',
      affectedPaths: ['b.txt']
    })
  })

  it('an id collision with a rehydrated foreign-root item refuses the merge', () => {
    // The cross-run hazard (defense in depth behind run-unique turn ids):
    // run 1 persisted pc_t1 captured in /old-root; even if a colliding id
    // reaches recordWrites, the queue must refuse rather than rebind the
    // rehydrated item's capturedRoot and merge paths across trees.
    const h = makeHarness()
    h.queue.rehydrate([persistedItem({ id: 'pc_t1', capturedRoot: '/old-root' })])
    expect(h.queue.list()).toHaveLength(1)

    const refused = h.queue.recordWrites({
      turnId: 't1',
      threadId: 'th-9',
      agentId: 'other-agent',
      paths: ['README.md'],
      capturedRoot: '/workspace'
    })

    expect(refused).toBeNull()
    const item = h.queue.list()[0]
    expect(item?.capturedRoot).toBe('/old-root')
    expect(item?.threadId).toBe('th-1') // attribution never overwritten
    expect(item?.paths).toEqual(['a.txt'])
    expect(h.audit.at(-1)).toMatchObject({
      tool: 'approvals:record-refused',
      error: 'captured-root-mismatch'
    })
  })
})

// ---------------------------------------------------------------------------
// gate-confirm root binding (v1.3.0)
// ---------------------------------------------------------------------------

describe('ApprovalQueue gate-confirm root binding (v1.3.0)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('records the captured root on the gate-confirm item', () => {
    const h = makeHarness()
    void h.queue.enqueueGateConfirm(GATE_OPTS, 30_000)
    expect(h.queue.list()[0]?.capturedRoot).toBe('/workspace')
  })

  it('cross-root resolution refuses workspace-changed, leaves the waiter pending, and resolves after switching back', async () => {
    const h = makeHarness()
    const decision = h.queue.enqueueGateConfirm(GATE_OPTS, 30_000)
    let settled = false
    void decision.then(() => {
      settled = true
    })
    const id = h.queue.list()[0]?.id ?? ''

    h.setRoot('/other-workspace')
    const result = await h.queue.resolve(id, true)
    expect(result).toEqual({ ok: false, reason: 'workspace-changed' })
    expect(h.queue.list()).toHaveLength(1) // retained
    await Promise.resolve()
    expect(settled).toBe(false) // the decision was NOT answered cross-root
    expect(h.audit[0]).toMatchObject({ decision: 'error', error: 'workspace-changed' })

    h.setRoot('/workspace')
    const ok = await h.queue.resolve(id, true)
    expect(ok).toEqual({ ok: true })
    await expect(decision).resolves.toMatchObject({ allowed: true })
  })

  it('the remove-on-timeout still bounds a cross-root confirm (no zombie row)', async () => {
    vi.useFakeTimers()
    const h = makeHarness()
    const decision = h.queue.enqueueGateConfirm(GATE_OPTS, 30_000)
    h.setRoot('/other-workspace')

    vi.advanceTimersByTime(30_000)

    await expect(decision).resolves.toMatchObject({ allowed: false })
    expect(h.queue.list()).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// rehydrate (restart survival, v1.3.0)
// ---------------------------------------------------------------------------

describe('ApprovalQueue rehydrate (v1.3.0)', () => {
  it('restores an item whose fresh diff matches, resolvable in its root', async () => {
    const h = makeHarness() // diff stub returns 'diff-v1' — matches the fixture
    h.queue.rehydrate([persistedItem()])

    expect(h.queue.list().map((i) => i.id)).toEqual(['pc_r1'])
    expect(h.audit).toHaveLength(0)
    const result = await h.queue.resolve('pc_r1', true)
    expect(result.ok).toBe(true)
  })

  it('re-validates against the item OWN capturedRoot, and resolution stays root-bound', async () => {
    const h = makeHarness() // active root: /workspace
    h.queue.rehydrate([persistedItem({ capturedRoot: '/elsewhere' })])

    expect(h.git.diff).toHaveBeenCalledWith('/elsewhere', ['a.txt'])
    expect(h.queue.list()).toHaveLength(1)
    // Foreign-root item is visible but not resolvable from here.
    const result = await h.queue.resolve('pc_r1', true)
    expect(result).toEqual({ ok: false, reason: 'workspace-changed' })
  })

  it('drops + audits an item whose disk state drifted while the app was closed', () => {
    const h = makeHarness()
    h.setDiff('diff-v2') // disk changed since the persisted snapshot
    h.queue.rehydrate([persistedItem()])

    expect(h.queue.list()).toEqual([])
    expect(h.audit).toHaveLength(1)
    expect(h.audit[0]).toMatchObject({
      tool: 'approvals:rehydrate-drop',
      decision: 'error',
      error: 'stale-diff',
      affectedPaths: ['a.txt']
    })
    // The pruned mirror is re-persisted without the dropped item.
    expect(h.persisted.at(-1)).toEqual([])
  })

  it('drops + audits when the diff cannot be recomputed (conservative: drop, never keep)', () => {
    const h = makeHarness()
    h.git.diff.mockImplementation(() => {
      throw new Error('git exploded')
    })
    h.queue.rehydrate([persistedItem()])

    expect(h.queue.list()).toEqual([])
    expect(h.audit[0]).toMatchObject({ error: 'diff-failed' })
  })

  it('drops + audits when the fresh diff is the [diff unavailable] marker (unverifiable ≠ match)', () => {
    // GitService.diff converts failures into a stable marker STRING rather
    // than throwing; an item persisted with the same marker (its capture-time
    // diff also failed) would compare equal and silently survive rehydrate.
    const h = makeHarness()
    h.setDiff('[diff unavailable: a.txt]\n')
    h.queue.rehydrate([persistedItem({ diff: '[diff unavailable: a.txt]\n' })])

    expect(h.queue.list()).toEqual([])
    expect(h.audit[0]).toMatchObject({
      tool: 'approvals:rehydrate-drop',
      decision: 'error',
      error: 'diff-failed'
    })
  })

  it('drops + audits an item with no captured root', () => {
    const h = makeHarness()
    h.queue.rehydrate([persistedItem({ capturedRoot: null })])

    expect(h.queue.list()).toEqual([])
    expect(h.audit[0]).toMatchObject({ error: 'no-captured-root' })
  })

  it('never rehydrates a gate-confirm kind (tampered mirror)', () => {
    const h = makeHarness()
    h.queue.rehydrate([persistedItem({ id: 'gc_9', kind: 'gate-confirm' })])

    expect(h.queue.list()).toEqual([])
    expect(h.audit[0]).toMatchObject({ error: 'gate-confirm-never-rehydrated' })
  })

  it('never clobbers a live item with the same id', () => {
    const h = makeHarness()
    recordTurn(h, 'r1') // live pc_r1
    const live = h.queue.list()[0]
    h.queue.rehydrate([persistedItem({ diff: 'something-else' })])

    expect(h.queue.list()).toEqual([live])
    expect(h.audit).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Integration: real GitService on a real temp repo
// ---------------------------------------------------------------------------

describe('ApprovalQueue with real git-service', () => {
  let root: string

  function makeRealQueue(): { queue: ApprovalQueue; audit: AuditEntry[] } {
    const audit: AuditEntry[] = []
    const git: ApprovalQueueGitDeps = {
      isRepo: isGitRepo,
      diff: gitDiff,
      commitApproved,
      discard: (repoRoot, paths) => gitDiscard(repoRoot, paths, (abs) => rm(abs)),
      ignoredUntracked
    }
    const queue = new ApprovalQueue({
      git,
      audit: { log: (entry) => audit.push(entry) },
      getRoot: () => root,
      notify: () => {}
    })
    return { queue, audit }
  }

  function initRepo(dir: string): void {
    const opts = { cwd: dir, stdio: 'ignore' } as const
    execFileSync('git', ['init', '--quiet'], opts)
    execFileSync('git', ['config', 'user.email', 'test@example.com'], opts)
    execFileSync('git', ['config', 'user.name', 'Test'], opts)
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], opts)
    writeFileSync(join(dir, '.gitkeep'), '')
    execFileSync('git', ['add', '.'], opts)
    execFileSync('git', ['commit', '-m', 'initial', '--quiet', '--no-verify'], opts)
  }

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('stale-diff on a real repo, then approve lands a trailer commit', async () => {
    root = mkdtempSync(join(tmpdir(), 'machina-approval-queue-'))
    initRepo(root)
    const { queue } = makeRealQueue()

    writeFileSync(join(root, 'new.txt'), 'agent v1\n')
    const change = mustRecord(
      queue.recordWrites({
        turnId: 'turn-1',
        threadId: 'th-00000001',
        agentId: 'fixer',
        paths: ['new.txt']
      })
    )
    expect(change.diff).toContain('agent v1') // untracked file reviews non-blind

    // The file changes after review: resolve must refuse with stale-diff.
    writeFileSync(join(root, 'new.txt'), 'agent v2\n')
    const stale = await queue.resolve('pc_turn-1', true, 'feat: add new file')
    expect(stale).toEqual({ ok: false, reason: 'stale-diff' })

    // Re-review against the refreshed snapshot, then approve.
    const approved = await queue.resolve('pc_turn-1', true, 'feat: add new file')
    expect(approved.ok).toBe(true)
    const body = execFileSync('git', ['log', '-1', '--pretty=%B'], {
      cwd: root,
      encoding: 'utf-8'
    })
    expect(body).toContain('Machina-Agent: fixer')
    expect(body).toContain('Machina-Session: th-00000001')
  })

  it('reject on a real repo removes the untracked file and empties the queue', async () => {
    root = mkdtempSync(join(tmpdir(), 'machina-approval-queue-'))
    initRepo(root)
    const { queue } = makeRealQueue()

    writeFileSync(join(root, 'scratch.txt'), 'unwanted\n')
    queue.recordWrites({
      turnId: 'turn-2',
      threadId: 'th-00000002',
      agentId: 'fixer',
      paths: ['scratch.txt']
    })

    const rejected = await queue.resolve('pc_turn-2', false)
    expect(rejected).toEqual({ ok: true })
    expect(existsSync(join(root, 'scratch.txt'))).toBe(false)
    expect(queue.list()).toEqual([])
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf-8' })
    expect(status.trim()).toBe('')
  })

  it('per-turn granularity: approve turn 1, reject turn 2, turn-1 commit intact', async () => {
    // Step-5 evidence gate G8: the queue must give at least the per-turn
    // granularity the retired per-turn snapshot gave — resolving one turn
    // never disturbs another turn's already-approved commit.
    root = mkdtempSync(join(tmpdir(), 'machina-approval-queue-'))
    initRepo(root)
    const { queue } = makeRealQueue()

    // Turn 1 creates a file; approve lands it as a trailer commit.
    writeFileSync(join(root, 'turn1.txt'), 'turn one\n')
    queue.recordWrites({
      turnId: 'turn-1',
      threadId: 'th-00000001',
      agentId: 'fixer',
      paths: ['turn1.txt']
    })
    const approved = await queue.resolve('pc_turn-1', true, 'feat: turn one')
    expect(approved.ok).toBe(true)
    const turn1Sha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf-8'
    }).trim()

    // Turn 2 creates another file; reject discards it.
    writeFileSync(join(root, 'turn2.txt'), 'turn two\n')
    queue.recordWrites({
      turnId: 'turn-2',
      threadId: 'th-00000001',
      agentId: 'fixer',
      paths: ['turn2.txt']
    })
    const rejected = await queue.resolve('pc_turn-2', false)
    expect(rejected).toEqual({ ok: true })

    // Turn 1's commit and content are untouched; turn 2's file is gone.
    expect(
      execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf-8' }).trim()
    ).toBe(turn1Sha)
    expect(readFileSync(join(root, 'turn1.txt'), 'utf-8')).toBe('turn one\n')
    expect(existsSync(join(root, 'turn2.txt'))).toBe(false)
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf-8' })
    expect(status.trim()).toBe('')
  })

  it('ignoredUntracked flags gitignored-untracked files but not tracked-but-ignored ones', () => {
    root = mkdtempSync(join(tmpdir(), 'machina-approval-queue-'))
    initRepo(root)
    const opts = { cwd: root, stdio: 'ignore' } as const

    writeFileSync(join(root, '.gitignore'), '.env\napp.log\n')
    writeFileSync(join(root, '.env'), 'SECRET=1\n')
    writeFileSync(join(root, 'src.ts'), 'export {}\n')
    expect(ignoredUntracked(root, ['src.ts', '.env'])).toEqual(['.env'])

    // Tracked-but-ignored: force-added and committed, then modified. It
    // stages fine, so it must NOT be returned.
    writeFileSync(join(root, 'app.log'), 'v1\n')
    execFileSync('git', ['add', '-f', 'app.log'], opts)
    execFileSync('git', ['commit', '-m', 'track ignored log', '--quiet', '--no-verify'], opts)
    writeFileSync(join(root, 'app.log'), 'v2\n')
    expect(ignoredUntracked(root, ['app.log', '.env'])).toEqual(['.env'])
  })
})
