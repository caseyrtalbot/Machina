// @vitest-environment node
// ApprovalQueue v1.3.0 scope/persistence + real git-service integration +
// v1.3.1 delta-notify and gate-hold suites. Split from approval-queue.test.ts
// (800-line ceiling); shared fakes live in approval-queue-harness.ts.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { ApprovalQueue } from '../../src/main/services/approval-queue'
import type { ApprovalQueueGitDeps } from '../../src/main/services/approval-queue'
import type { HitlDecision } from '../../src/main/services/hitl-gate'
import type { AuditEntry } from '../../src/shared/agent-types'
import {
  isGitRepo,
  diff as gitDiff,
  commitApproved,
  discard as gitDiscard,
  ignoredUntracked
} from '../../src/main/services/git-service'
import {
  GATE_OPTS,
  makeHarness,
  mustRecord,
  persistedItem,
  recordTurn
} from './approval-queue-harness'

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

// ---------------------------------------------------------------------------
// delta notify (v1.3.1, Phase 3 step 2)
// ---------------------------------------------------------------------------

describe('ApprovalQueue delta notify (v1.3.1)', () => {
  it('a genuinely-new item appears in the delta exactly once', () => {
    const h = makeHarness()
    recordTurn(h, 't1')

    expect(h.addedDeltas).toHaveLength(1)
    expect(h.addedDeltas[0]).toEqual([
      {
        id: 'pc_t1',
        kind: 'cli-change',
        agentId: 'fixer',
        threadId: 'th-1',
        capturedRoot: '/workspace',
        pathCount: 1
      }
    ])
  })

  it('coalescing into an existing turn item adds nothing to the delta', () => {
    const h = makeHarness()
    recordTurn(h, 't1')
    mustRecord(
      h.queue.recordWrites({ turnId: 't1', threadId: 'th-1', agentId: 'fixer', paths: ['b.txt'] })
    )

    expect(h.addedDeltas).toHaveLength(2)
    expect(h.addedDeltas[1]).toEqual([])
  })

  it('flag merges add nothing to the delta', () => {
    const h = makeHarness()
    recordTurn(h, 't1')
    h.queue.flagExisting('t1', { headMoved: true })

    expect(h.addedDeltas[1]).toEqual([])
  })

  it('resolves NEVER appear in the delta (approve and reject)', async () => {
    const h = makeHarness()
    recordTurn(h, 't1')
    recordTurn(h, 't2')

    await h.queue.resolve('pc_t1', true)
    await h.queue.resolve('pc_t2', false)

    expect(h.addedDeltas).toHaveLength(4)
    expect(h.addedDeltas[2]).toEqual([])
    expect(h.addedDeltas[3]).toEqual([])
  })

  it('gate-confirm items carry their kind in the delta', async () => {
    const h = makeHarness()
    const decision = h.queue.enqueueGateConfirm(GATE_OPTS, 30_000)

    expect(h.addedDeltas[0]).toEqual([
      {
        id: 'gc_1',
        kind: 'gate-confirm',
        agentId: 'vault.write_file',
        threadId: 'mcp-gate',
        capturedRoot: '/workspace',
        pathCount: 1
      }
    ])

    await h.queue.resolve('gc_1', false)
    await decision
  })

  it('rehydrated items count as new to this app run', () => {
    const h = makeHarness()
    h.queue.rehydrate([persistedItem()])

    expect(h.addedDeltas).toHaveLength(1)
    expect(h.addedDeltas[0].map((a) => a.id)).toEqual(['pc_r1'])
  })
})

// ---------------------------------------------------------------------------
// enqueueGateHold / removeGateHold (v1.3.1, native mirror)
// ---------------------------------------------------------------------------

const HOLD_OPTS = {
  tool: 'write_note',
  path: 'notes/idea.md',
  description: 'Native agent wants to create this note — awaiting your confirmation',
  contentPreview: 'hello',
  threadId: 'th-native'
} as const

describe('ApprovalQueue enqueueGateHold / removeGateHold (v1.3.1)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('enqueues a gate-confirm row that is NEVER persisted', () => {
    const h = makeHarness()
    const id = h.queue.enqueueGateHold(HOLD_OPTS, () => {})

    const item = h.queue.list()[0]
    expect(id).toBe('gh_1')
    expect(item?.kind).toBe('gate-confirm')
    expect(item?.agentId).toBe('write_note')
    expect(item?.threadId).toBe('th-native')
    expect(item?.paths).toEqual(['notes/idea.md'])
    expect(item?.diff).toBe('hello')
    expect(item?.capturedRoot).toBe('/workspace')
    // Pinned invariant: gate-confirms are never serialized.
    expect(h.persisted.flat()).toEqual([])
  })

  it('has NO auto-deny timer: the row survives past the 30s confirm timeout', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    const onDecision = vi.fn()
    h.queue.enqueueGateHold(HOLD_OPTS, onDecision)

    vi.advanceTimersByTime(120_000)

    expect(h.queue.list()).toHaveLength(1)
    expect(onDecision).not.toHaveBeenCalled()
  })

  it('tray resolve invokes onDecision exactly once and removes the row', async () => {
    const h = makeHarness()
    const decisions: HitlDecision[] = []
    const id = h.queue.enqueueGateHold(HOLD_OPTS, (d) => decisions.push(d))

    const result = await h.queue.resolve(id, true)

    expect(result).toEqual({ ok: true })
    expect(decisions).toEqual([{ allowed: true, reason: 'User approved via approvals queue' }])
    expect(h.queue.list()).toEqual([])
    // A second resolve is an unknown change — never a second decision.
    const late = await h.queue.resolve(id, false)
    expect(late).toEqual({ ok: false, reason: 'unknown-change' })
    expect(decisions).toHaveLength(1)
  })

  it('removeGateHold removes silently (no decision) and audits the release', () => {
    const h = makeHarness()
    const onDecision = vi.fn()
    const id = h.queue.enqueueGateHold(HOLD_OPTS, onDecision)

    expect(h.queue.removeGateHold(id, false)).toBe(true)

    expect(h.queue.list()).toEqual([])
    expect(onDecision).not.toHaveBeenCalled()
    const released = h.audit.filter((e) => e.tool === 'approvals:hold-released')
    expect(released).toHaveLength(1)
    expect(released[0].decision).toBe('denied')
  })

  it('removeGateHold after a tray resolve is a no-op (single resolution authority)', async () => {
    const h = makeHarness()
    const id = h.queue.enqueueGateHold(HOLD_OPTS, () => {})
    await h.queue.resolve(id, true)

    expect(h.queue.removeGateHold(id, true)).toBe(false)
    expect(h.audit.filter((e) => e.tool === 'approvals:hold-released')).toHaveLength(0)
  })

  it('cross-root resolution refuses workspace-changed and retains the row', async () => {
    const h = makeHarness()
    const onDecision = vi.fn()
    const id = h.queue.enqueueGateHold(HOLD_OPTS, onDecision)

    h.setRoot('/elsewhere')
    const result = await h.queue.resolve(id, true)

    expect(result).toEqual({ ok: false, reason: 'workspace-changed' })
    expect(onDecision).not.toHaveBeenCalled()
    expect(h.queue.list()).toHaveLength(1)
  })
})
