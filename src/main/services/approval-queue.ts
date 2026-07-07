/**
 * Approval queue for agent-written changes (workstation contracts §4/§6, v1.1).
 *
 * Post-persistence containment: writes are already on disk when they land
 * here. The queue governs whether they get blessed into history
 * (GitService.commitApproved with attribution trailers) or reverted
 * (GitService.discard). One PendingChange per turn, keyed `pc_<turnId>`,
 * coalescing writes as they land. Every resolve() writes exactly one
 * AuditEntry (`tool: 'approvals:resolve'`).
 *
 * All dependencies (git functions, audit logger, root resolution) are
 * constructor-injected so the queue runs — and tests run — without Electron.
 * Result-style errors only; nothing throws across the service boundary.
 */
import type { AuditEntry } from '@shared/agent-types'
import type {
  CommitApprovedOpts,
  GitOpResult,
  PendingChange,
  PendingChangeFlags
} from '@shared/git-types'
import type { HitlConfirmOpts, HitlDecision } from './hitl-gate'

/** Gate-confirm items auto-deny (and are removed) after this long with no answer. */
export const GATE_CONFIRM_TIMEOUT_MS = 30_000

export interface RecordWritesOpts {
  readonly turnId: string
  readonly threadId: string
  readonly agentId: string
  readonly paths: readonly string[]
  /** OR-merged into the item's existing flags (a tripped flag never untrips). */
  readonly flags?: Partial<PendingChangeFlags>
  readonly description?: string
}

/** The slice of GitService the queue consumes, injected for Electron-free tests. */
export interface ApprovalQueueGitDeps {
  readonly isRepo: (root: string) => boolean
  readonly diff: (root: string, paths?: readonly string[]) => string
  readonly commitApproved: (root: string, opts: CommitApprovedOpts) => GitOpResult
  /** Pre-bound discard: the IPC layer injects the removeFile (trash) callback. */
  readonly discard: (root: string, paths: readonly string[]) => Promise<GitOpResult>
  /**
   * Paths `git add` would refuse (gitignored, untracked, absent from HEAD).
   * Approve stages around them — `git add` exits 1 on any ignored pathname
   * while still staging the rest, which would brick the item on every retry.
   */
  readonly ignoredUntracked: (root: string, paths: readonly string[]) => readonly string[]
}

export interface ApprovalQueueDeps {
  readonly git: ApprovalQueueGitDeps
  readonly audit: { log(entry: AuditEntry): void }
  /** Workspace root resolution (WorkspaceService.current() at the IPC layer). */
  readonly getRoot: () => string | null
  /** Fires on EVERY queue mutation with the pending count (→ approvals:changed). */
  readonly notify: (pending: number) => void
  /** Injectable clock (ISO 8601) for deterministic tests. */
  readonly now?: () => string
}

const NO_FLAGS: PendingChangeFlags = {
  highVelocity: false,
  headMoved: false,
  concurrentTurns: false,
  degradedAttribution: false,
  gateDegraded: false,
  forbidden: false
}

function mergeFlags(
  base: PendingChangeFlags,
  extra?: Partial<PendingChangeFlags>
): PendingChangeFlags {
  if (extra === undefined) return base
  return {
    highVelocity: base.highVelocity || extra.highVelocity === true,
    headMoved: base.headMoved || extra.headMoved === true,
    concurrentTurns: base.concurrentTurns || extra.concurrentTurns === true,
    degradedAttribution: base.degradedAttribution || extra.degradedAttribution === true,
    gateDegraded: base.gateDegraded || extra.gateDegraded === true,
    forbidden: base.forbidden || extra.forbidden === true
  }
}

function dedupe(paths: readonly string[]): readonly string[] {
  return [...new Set(paths)]
}

interface GateWaiter {
  readonly resolve: (decision: HitlDecision) => void
  readonly timer: ReturnType<typeof setTimeout>
}

export class ApprovalQueue {
  private readonly items = new Map<string, PendingChange>()
  /**
   * Workspace root each cli-change was captured against. A change recorded in
   * one workspace must never be committed/discarded against another after a
   * workspace switch — resolve() re-reads getRoot() and asserts it matches.
   */
  private readonly capturedRoots = new Map<string, string | null>()
  private readonly gateWaiters = new Map<string, GateWaiter>()
  private gateSeq = 0

  constructor(private readonly deps: ApprovalQueueDeps) {}

  /** Insert (or replace) a pre-formed pending change. */
  add(change: PendingChange): void {
    this.items.set(change.id, change)
    this.capturedRoots.set(change.id, this.deps.getRoot())
    this.notifyChanged()
  }

  /**
   * Coalesce a batch of attributed writes into the turn's single item
   * (`pc_<turnId>`): paths union, flags OR-merged, diff snapshot recomputed
   * over the merged set so the review artifact always covers everything.
   */
  recordWrites(opts: RecordWritesOpts): PendingChange {
    const id = `pc_${opts.turnId}`
    const existing = this.items.get(id)
    const root = this.deps.getRoot()
    const paths = dedupe(existing === undefined ? opts.paths : [...existing.paths, ...opts.paths])
    const description = opts.description ?? existing?.description
    const base: PendingChange = {
      id,
      kind: 'cli-change',
      threadId: opts.threadId,
      agentId: opts.agentId,
      paths,
      diff: root === null ? '' : this.deps.git.diff(root, paths),
      capturedAt: this.nowIso(),
      revertible: root !== null && this.deps.git.isRepo(root),
      flags: mergeFlags(existing?.flags ?? NO_FLAGS, opts.flags)
    }
    const change = description === undefined ? base : { ...base, description }
    this.items.set(id, change)
    this.capturedRoots.set(id, root)
    this.notifyChanged()
    return change
  }

  list(): readonly PendingChange[] {
    return [...this.items.values()]
  }

  /**
   * OR-merge flags into an EXISTING turn item without touching paths/diff.
   * Used by the end-of-turn headMoved tripwire — a turn whose only git
   * activity was a self-commit has no fs-event path into recordWrites.
   * Returns false (and records nothing) when no item exists for the turn.
   */
  flagExisting(turnId: string, flags: Partial<PendingChangeFlags>): boolean {
    const id = `pc_${turnId}`
    const existing = this.items.get(id)
    if (existing === undefined) return false
    this.items.set(id, { ...existing, flags: mergeFlags(existing.flags, flags) })
    this.notifyChanged()
    return true
  }

  /**
   * Immediate containment for HARNESS_PROTECTED_GLOBS hits (contracts §4/§5):
   * discard the forbidden paths right now — no user round-trip — and audit.
   * Operates on ONLY the forbidden paths, never the turn's whole item: a
   * merged discard would revert legitimate writes still awaiting review.
   * Non-repo (or failed discard): nothing can be restored, so the paths are
   * recorded into the turn's item flagged `forbidden` — visibility must not
   * vanish just because rollback is impossible.
   *
   * `expectedRoot` is the watcher's own root: during a workspace switch the
   * old watcher can still flush a batch AFTER the active workspace flipped,
   * and a discard against the new root with old-root-relative paths would be
   * destructive. Mismatch → audit only, no discard, no queue item.
   */
  async autoReject(opts: RecordWritesOpts, expectedRoot?: string): Promise<GitOpResult> {
    const root = this.deps.getRoot()
    if (expectedRoot !== undefined && root !== expectedRoot) {
      const result: GitOpResult = { ok: false, reason: 'workspace-changed' }
      this.auditAutoReject(opts, 'error', result)
      return result
    }
    const flagged: RecordWritesOpts = {
      ...opts,
      flags: { ...opts.flags, forbidden: true }
    }
    if (root === null || !this.deps.git.isRepo(root)) {
      this.recordWrites(flagged)
      const result: GitOpResult = {
        ok: false,
        reason: root === null ? 'no-workspace' : 'not-a-git-repo'
      }
      this.auditAutoReject(opts, 'error', result)
      return result
    }
    const result = await this.deps.git.discard(root, opts.paths)
    if (!result.ok) {
      this.recordWrites(flagged)
      this.auditAutoReject(opts, 'error', result)
      return result
    }
    this.auditAutoReject(opts, 'denied', result)
    return result
  }

  /**
   * Drop every item and deny every waiting gate confirm — called when the
   * approvals surface re-binds to a new workspace root. Items captured
   * against the old root must never be resolvable against the new one.
   */
  clear(): void {
    for (const waiter of this.gateWaiters.values()) {
      clearTimeout(waiter.timer)
      waiter.resolve({
        allowed: false,
        reason: 'Denied: approval queue cleared (workspace changed)'
      })
    }
    this.gateWaiters.clear()
    this.items.clear()
    this.capturedRoots.clear()
    this.notifyChanged()
  }

  /**
   * Resolve one pending change. approve → commitApproved (trailers) when the
   * root is a repo, else acknowledge + audit; reject → discard, except
   * non-repo where the item is RETAINED (`not-a-git-repo` — nothing to
   * restore from, visibility must not vanish). TOCTOU guard: the diff is
   * recomputed first; a mismatch with the reviewed snapshot refreshes the
   * item and returns `stale-diff`, forcing re-review.
   */
  async resolve(id: string, approve: boolean, message?: string): Promise<GitOpResult> {
    const item = this.items.get(id)
    if (item === undefined) {
      return this.audited(
        id,
        approve,
        [],
        'error',
        { ok: false, reason: 'unknown-change' },
        message
      )
    }

    if (item.kind === 'gate-confirm') {
      return this.resolveGateConfirm(id, item, approve, message)
    }

    const root = this.deps.getRoot()
    if (root === null) {
      return this.audited(
        id,
        approve,
        item.paths,
        'error',
        { ok: false, reason: 'no-workspace' },
        message
      )
    }

    // Workspace binding: BEFORE the stale-diff recompute, or the refresh would
    // re-snapshot the item against the wrong workspace's files.
    const capturedRoot = this.capturedRoots.get(id)
    if (capturedRoot !== undefined && capturedRoot !== root) {
      return this.audited(
        id,
        approve,
        item.paths,
        'error',
        { ok: false, reason: 'workspace-changed' },
        message
      )
    }

    // TOCTOU guard: what was reviewed must match what is on disk now.
    const currentDiff = this.deps.git.diff(root, item.paths)
    if (currentDiff !== item.diff) {
      this.items.set(id, { ...item, diff: currentDiff, capturedAt: this.nowIso() })
      this.notifyChanged()
      return this.audited(
        id,
        approve,
        item.paths,
        'error',
        { ok: false, reason: 'stale-diff' },
        message
      )
    }

    const isRepo = this.deps.git.isRepo(root)
    if (approve) {
      if (!isRepo) {
        // Non-repo: no commit possible — acknowledge + audit only.
        this.items.delete(id)
        this.capturedRoots.delete(id)
        this.notifyChanged()
        return this.audited(id, approve, item.paths, 'allowed', { ok: true }, message)
      }
      // Gitignored-untracked paths cannot be staged; commit around them.
      // They were still reviewed (the diff synthesizes them via --no-index)
      // and the audit entry names what was acknowledged without a commit.
      const skippedIgnored = this.deps.git.ignoredUntracked(root, item.paths)
      const commitPaths = item.paths.filter((p) => !skippedIgnored.includes(p))
      if (commitPaths.length === 0) {
        // Everything in the item is unstageable — approve degrades to the
        // acknowledge path (same as non-repo), never to a stuck item.
        this.items.delete(id)
        this.capturedRoots.delete(id)
        this.notifyChanged()
        return this.audited(id, approve, item.paths, 'allowed', { ok: true }, message)
      }
      const trimmed = message?.trim() ?? ''
      const result = this.deps.git.commitApproved(root, {
        agentId: item.agentId,
        threadId: item.threadId,
        paths: commitPaths,
        message: trimmed.length > 0 ? trimmed : `Approve agent changes (${item.agentId})`
      })
      if (!result.ok) {
        // Item retained so the user can retry after fixing the cause.
        return this.audited(id, approve, item.paths, 'error', result, message)
      }
      this.items.delete(id)
      this.capturedRoots.delete(id)
      this.notifyChanged()
      return this.audited(id, approve, item.paths, 'allowed', result, message)
    }

    if (!isRepo) {
      // Reject needs git to revert; the item is retained for visibility.
      return this.audited(
        id,
        approve,
        item.paths,
        'error',
        { ok: false, reason: 'not-a-git-repo' },
        message
      )
    }
    const result = await this.deps.git.discard(root, item.paths)
    if (!result.ok) {
      return this.audited(id, approve, item.paths, 'error', result, message)
    }
    this.items.delete(id)
    this.capturedRoots.delete(id)
    this.notifyChanged()
    return this.audited(id, approve, item.paths, 'denied', result, message)
  }

  /**
   * Queue a HITL gate confirmation as a 'gate-confirm' PendingChange and wait
   * for the user's decision via resolve(). On timeout the request auto-DENIES
   * and the item is REMOVED — a stale confirm must not catch a late click.
   */
  enqueueGateConfirm(
    opts: HitlConfirmOpts,
    timeoutMs: number = GATE_CONFIRM_TIMEOUT_MS
  ): Promise<HitlDecision> {
    this.gateSeq += 1
    const id = `gc_${this.gateSeq}`
    const change: PendingChange = {
      id,
      kind: 'gate-confirm',
      threadId: 'mcp-gate',
      agentId: opts.tool,
      paths: [opts.path],
      diff: opts.contentPreview ?? '',
      capturedAt: this.nowIso(),
      revertible: false,
      flags: NO_FLAGS,
      description: opts.description
    }
    return new Promise<HitlDecision>((resolveDecision) => {
      const timer = setTimeout(() => {
        this.gateWaiters.delete(id)
        if (this.items.delete(id)) this.notifyChanged()
        resolveDecision({
          allowed: false,
          reason: `Denied: approval queue timeout (${timeoutMs}ms)`
        })
      }, timeoutMs)
      this.gateWaiters.set(id, { resolve: resolveDecision, timer })
      this.items.set(id, change)
      this.notifyChanged()
    })
  }

  // -- Internal --

  private resolveGateConfirm(
    id: string,
    item: PendingChange,
    approve: boolean,
    message?: string
  ): GitOpResult {
    const waiter = this.gateWaiters.get(id)
    this.gateWaiters.delete(id)
    this.items.delete(id)
    this.notifyChanged()
    if (waiter !== undefined) {
      clearTimeout(waiter.timer)
      waiter.resolve({
        allowed: approve,
        reason: approve ? 'User approved via approvals queue' : 'User denied via approvals queue'
      })
    }
    return this.audited(
      id,
      approve,
      item.paths,
      approve ? 'allowed' : 'denied',
      { ok: true },
      message
    )
  }

  private auditAutoReject(
    opts: RecordWritesOpts,
    decision: AuditEntry['decision'],
    result: GitOpResult
  ): void {
    this.deps.audit.log({
      ts: this.nowIso(),
      tool: 'approvals:auto-reject',
      args: { turnId: opts.turnId, threadId: opts.threadId, agentId: opts.agentId },
      affectedPaths: [...opts.paths],
      decision,
      ...(result.ok ? {} : { error: result.reason })
    })
  }

  /** Write the resolve's single AuditEntry and pass the result through. */
  private audited(
    id: string,
    approve: boolean,
    affectedPaths: readonly string[],
    decision: AuditEntry['decision'],
    result: GitOpResult,
    message?: string
  ): GitOpResult {
    const entry: AuditEntry = {
      ts: this.nowIso(),
      tool: 'approvals:resolve',
      args: message === undefined ? { id, approve } : { id, approve, message },
      affectedPaths: [...affectedPaths],
      decision,
      ...(result.ok ? {} : { error: result.reason })
    }
    this.deps.audit.log(entry)
    return result
  }

  private nowIso(): string {
    return this.deps.now?.() ?? new Date().toISOString()
  }

  private notifyChanged(): void {
    this.deps.notify(this.items.size)
  }
}
