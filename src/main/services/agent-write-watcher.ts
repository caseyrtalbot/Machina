/**
 * Agent write watcher (workstation step 3, contracts §4 v1.1.1).
 *
 * Watches the workspace root with its OWN chokidar instance and its OWN
 * ignore policy — explicitly NOT vault-watcher's DEFAULT_IGNORE_PATTERNS,
 * which ignore TE_DIR and every dotpath and would blind the verify.sh
 * auto-reject and all `.env` writes. `.gitignore` is NOT honored: an agent
 * write to an ignored `.env` must not be invisible (git cannot diff or
 * commit it, but the queue shows it).
 *
 * Excluded (the app's own churn + noise): `.git`, `node_modules`,
 * `dist`/`build`/`out`, and `<TE_DIR>/{state.json,threads,artifacts,
 * embeddings}`. Watched: everything else, INCLUDING dotfiles, `.env`,
 * `.gitignore` itself, and `<TE_DIR>/agents/**`.
 *
 * Event routing per batch (pure `partitionBatch`, tested without chokidar):
 *   self-writes (DocumentManager.hasPendingWrite) → dropped
 *   HARNESS_PROTECTED_GLOBS hits                  → queue.autoReject + audit
 *   inside a turn window                          → queue.recordWrites + flags
 *   outside any turn window                       → audit only, never queued
 */
import { watch, type FSWatcher } from 'chokidar'
import { relative, resolve, sep } from 'path'
import { isHarnessProtectedPath, TE_DIR } from '@shared/constants'
import type { AuditEntry } from '@shared/agent-types'
import type {
  GitOpResult,
  PendingChange,
  PendingChangeFlags,
  WatcherState
} from '@shared/git-types'
import { EventBatcher, type BatchedEvent } from './event-batcher'
import { WriteRateLimiter } from './hitl-gate'
import { isAgentHeadMove, type ActiveTurnMatch } from './cli-turn-registry'
import type { RecordWritesOpts } from './approval-queue'

/** Mirrors vault-watcher's batching interval. */
const BATCH_INTERVAL_MS = 50
/**
 * Fallback maxWritesPerMinute for threads with NO bound harness budget
 * (ad-hoc threads, pre-step-6 bindings, backfills). Bound threads take their
 * threshold from the harness budgets snapshot via the injected
 * `getWriteBudget` provider (step 6, contracts §5 v1.2.6) — this constant is
 * the default, not a contract value read from any harness.
 */
export const DEFAULT_MAX_WRITES_PER_MINUTE = 10
/**
 * Cap on awaiting chokidar's initial-scan `ready` (contracts §4 v1.2.1). The
 * un-timed await could hang vault init forever when the scan never completes.
 */
const READY_TIMEOUT_MS = 30_000

/** Universal infra dirs, pruned at ANY depth (nested node_modules/submodules). */
const EXCLUDED_ANY_DEPTH = new Set(['.git', 'node_modules'])
/**
 * Build-output dirs, pruned at the TOP LEVEL only — contracts §4 lists the
 * workspace's own build dirs; a nested `scripts/build/` or `packages/x/out/`
 * is legitimate source an agent write must not silently escape through.
 */
const EXCLUDED_TOP_LEVEL = new Set(['dist', 'build', 'out'])
/** App-state churn under TE_DIR that must never reach the queue. */
const EXCLUDED_TE_SUBPATHS = ['state.json', 'threads', 'artifacts', 'embeddings']

/**
 * The watcher's own ignore policy over workspace-root-relative paths.
 * Exported for direct unit testing.
 */
export function isWatcherIgnored(relPath: string): boolean {
  if (relPath.length === 0) return false
  const normalized = relPath.split(sep).join('/')
  const segments = normalized.split('/')
  if (segments.some((s) => EXCLUDED_ANY_DEPTH.has(s))) return true
  if (EXCLUDED_TOP_LEVEL.has(segments[0])) return true
  if (segments[0] === TE_DIR && segments.length >= 2) {
    return EXCLUDED_TE_SUBPATHS.includes(segments[1])
  }
  return false
}

export interface PartitionedBatch {
  readonly selfWrites: readonly BatchedEvent[]
  readonly forbidden: readonly BatchedEvent[]
  readonly attributed: readonly BatchedEvent[]
  readonly unattributed: readonly BatchedEvent[]
}

export interface PartitionDeps {
  /** DocumentManager.hasPendingWrite over the event's absolute path. */
  readonly isSelfWrite: (absPath: string) => boolean
  /** The active turn match, or null when no window qualifies. */
  readonly turn: ActiveTurnMatch | null
  /** HARNESS_PROTECTED_GLOBS matcher over the root-relative path. */
  readonly forbiddenMatcher: (relPath: string) => boolean
  /** Workspace root, for relativizing event paths. */
  readonly root: string
}

/**
 * Pure batch classifier — the watcher's whole routing decision, extracted so
 * tests never depend on chokidar timing. Order matters: a self-write is
 * dropped even on a protected path (the user may edit rules.md); forbidden
 * beats attribution (containment before review).
 */
export function partitionBatch(
  events: readonly BatchedEvent[],
  deps: PartitionDeps
): PartitionedBatch {
  const selfWrites: BatchedEvent[] = []
  const forbidden: BatchedEvent[] = []
  const attributed: BatchedEvent[] = []
  const unattributed: BatchedEvent[] = []
  for (const event of events) {
    if (deps.isSelfWrite(event.path)) {
      selfWrites.push(event)
    } else if (deps.forbiddenMatcher(relative(deps.root, event.path))) {
      forbidden.push(event)
    } else if (deps.turn !== null) {
      attributed.push(event)
    } else {
      unattributed.push(event)
    }
  }
  return { selfWrites, forbidden, attributed, unattributed }
}

/**
 * The circuit breaker's watcher-sourced signal port (step 6, contracts §5
 * v1.2.6). Structural — the watcher never imports the breaker module (which
 * carries electron singleton wiring); ipc/git.ts injects the singleton.
 * Every signal carries the batch's `concurrentTurns` ambiguity flag: the
 * breaker never auto-kills on ambiguous attribution.
 */
export interface AgentBreakerPort {
  noteVelocity(signal: {
    threadId: string
    agentId: string
    turnId: string
    concurrentTurns: boolean
    exceeded: boolean
  }): void
  noteForbiddenAutoReject(signal: {
    threadId: string
    agentId: string
    turnId: string
    concurrentTurns: boolean
  }): void
  noteHeadMoved(signal: {
    threadId: string
    agentId: string
    turnId: string
    concurrentTurns: boolean
  }): void
}

export interface AgentWriteWatcherDeps {
  readonly root: string
  readonly registry: {
    activeTurnFor(root: string, nowMs?: number): ActiveTurnMatch | null
  }
  readonly queue: {
    recordWrites(opts: RecordWritesOpts): PendingChange | null
    autoReject(opts: RecordWritesOpts, expectedRoot?: string): Promise<GitOpResult>
  }
  readonly audit: { log(entry: AuditEntry): void }
  readonly isSelfWrite: (absPath: string) => boolean
  /** GitService.headSha — the headMoved (agent-ran-git) tripwire. */
  readonly headSha: (root: string) => string | null
  /** GitService.commitsBetween — excuses the queue's own approval commits. */
  readonly commitsBetween: (root: string, from: string, to: string) => readonly string[] | null
  readonly now?: () => number
  /**
   * Health-state transitions (contracts §4 v1.2.1). Emitted on change only:
   * starting/watching from start(), degraded from caught batch/containment
   * failures, down from a post-ready chokidar error, stopped from stop().
   * start() FAILURES throw instead of emitting — the caller owns 'down'.
   */
  readonly onHealthChange?: (state: WatcherState, reason?: string) => void
  /** Injectable ready-await cap (tests); defaults to READY_TIMEOUT_MS. */
  readonly readyTimeoutMs?: number
  /** Injectable chokidar factory (tests exercise the ready/error/timeout race). */
  readonly watchFn?: typeof watch
  /**
   * Per-thread write-rate threshold from the bound harness's bind-time
   * budgets snapshot (step 6, contracts §5 v1.2.6). Undefined (unbound
   * ad-hoc thread, provider unwired) ⇒ DEFAULT_MAX_WRITES_PER_MINUTE. The
   * limiter stays keyed PER THREAD: concurrent threads bound to one slug
   * each get the full threshold (per-thread-per-slug semantics).
   */
  readonly getWriteBudget?: (threadId: string) => number | undefined
  /**
   * Aggregate (root, slug) write-rate ceiling from the bound harness's
   * bind-time budgets snapshot (`maxWritesPerMinutePerSlug`, Phase 3 step 5).
   * Returns the BINDING slug alongside the threshold so the aggregate is
   * keyed by the attribution authority, not the turn's possibly-degraded
   * agentId — a degraded-attribution turn (adapter-identity fallback) must
   * neither shard the slug's pool nor pollute the shared adapter key (v1.3.4
   * review fix). Undefined (field absent, unbound thread, provider unwired)
   * ⇒ the slug limiter is neither created, recorded into, nor evaluated —
   * attended behavior is unchanged (opt-in second ceiling).
   */
  readonly getSlugWriteBudget?: (
    threadId: string
  ) => { readonly slug: string; readonly maxWritesPerMinute: number } | undefined
  /** Circuit-breaker signal port (step 6); absent = signals unwired. */
  readonly breaker?: AgentBreakerPort
}

export class AgentWriteWatcher {
  private watcher: FSWatcher | null = null
  private batcher: EventBatcher | null = null
  /** Disarmed before the batcher's synchronous final flush in stop(). */
  private stopped = false
  /** Per-thread write velocity → the highVelocity flag. */
  private readonly limiters = new Map<string, WriteRateLimiter>()
  /**
   * Aggregate write velocity per slug (Phase 3 step 5), keyed by the BINDING
   * slug from getSlugWriteBudget — the watcher is already per-root, so the
   * pair is (root, slug) by construction. Instances share the per-thread
   * limiters' process-lifetime orphaning (never evicted; accepted cost).
   */
  private readonly slugLimiters = new Map<string, WriteRateLimiter>()
  /** relPath → suppression expiry (ms epoch) for the gate's own git/trash ops. */
  private readonly suppressed = new Map<string, number>()
  /** Turns whose headMoved tripwire already produced its one audit entry. */
  private readonly headMovedAudited = new Set<string>()
  /** Last emitted health state — transitions emit once (contracts §4 v1.2.1). */
  private health: WatcherState = 'stopped'

  constructor(private readonly deps: AgentWriteWatcherDeps) {}

  /**
   * Start watching and resolve once chokidar's initial scan is complete.
   * Writes landing mid-scan are treated as pre-existing by `ignoreInitial`
   * and silently swallowed — callers that need deterministic coverage from
   * a known point (tests, future health checks) must await this.
   *
   * The ready await races error and a timeout (contracts §4 v1.2.1) so a
   * scan that errors or never completes THROWS instead of hanging vault
   * init; the caller marks the gate down and the workspace stays live.
   */
  async start(): Promise<void> {
    await this.teardown()
    this.stopped = false
    this.setHealth('starting')
    this.batcher = new EventBatcher((events) => this.handleBatch(events), BATCH_INTERVAL_MS)
    const watchFn = this.deps.watchFn ?? watch
    this.watcher = watchFn(this.deps.root, {
      ignored: (path: string) => isWatcherIgnored(relative(this.deps.root, resolve(path))),
      persistent: true,
      ignoreInitial: true,
      followSymlinks: false,
      atomic: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 }
    })
    const enqueue = (event: BatchedEvent['event']) => (path: string) => {
      this.batcher?.enqueue(path, event)
    }
    let ready = false
    this.watcher
      .on('add', enqueue('add'))
      .on('change', enqueue('change'))
      .on('unlink', enqueue('unlink'))
      .on('error', (err) => {
        // An unhandled 'error' on the FSWatcher EventEmitter becomes an
        // uncaughtException (crash dialog + silently dead gate). Pre-ready
        // errors reject the ready race below; post-ready errors mean the
        // watcher can no longer be trusted to deliver coverage: audit +
        // down, and the ipc layer restarts with backoff.
        console.error('[agent-write-watcher] watcher error', err)
        if (!ready) return
        const message = err instanceof Error ? err.message : String(err)
        this.auditGateFailure('watcher error', message, [])
        this.setHealth('down', `watcher error: ${message}`)
      })
    const watcher = this.watcher
    const timeoutMs = this.deps.readyTimeoutMs ?? READY_TIMEOUT_MS
    try {
      await new Promise<void>((resolveReady, rejectReady) => {
        const timer = setTimeout(
          () => rejectReady(new Error(`watcher ready timeout after ${timeoutMs}ms`)),
          timeoutMs
        )
        watcher.once('ready', () => {
          clearTimeout(timer)
          resolveReady()
        })
        watcher.once('error', (err) => {
          if (ready) return
          clearTimeout(timer)
          rejectReady(err instanceof Error ? err : new Error(String(err)))
        })
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.auditGateFailure('watcher start failed', message, [])
      await this.teardown()
      // Reset silently (no 'stopped' emission): the caller reports 'down',
      // and a later start() must re-emit 'starting'.
      this.health = 'stopped'
      throw err
    }
    ready = true
    this.setHealth('watching')
  }

  async stop(): Promise<void> {
    await this.teardown()
    this.setHealth('stopped')
  }

  /** Close batcher + chokidar without emitting a health transition. */
  private async teardown(): Promise<void> {
    // Disarm FIRST: EventBatcher.stop() synchronously flushes the pending
    // batch, and a final flush during a workspace switch must not route
    // events (worst case: a destructive autoReject) against a stale root.
    this.stopped = true
    if (this.batcher) {
      this.batcher.stop()
      this.batcher = null
    }
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }
  }

  private setHealth(state: WatcherState, reason?: string): void {
    if (this.health === state) return
    this.health = state
    this.deps.onHealthChange?.(state, reason)
  }

  /**
   * Suppress the watcher's echo of the gate's OWN file operations (discard's
   * git-restore/trash). Without this, a Reject inside a still-open turn
   * window re-attributes the revert events and resurrects the just-resolved
   * item. TTL covers awaitWriteFinish (300ms) + batching + fs latency.
   */
  suppress(relPaths: readonly string[], ttlMs = 10_000): void {
    const expiry = (this.deps.now?.() ?? Date.now()) + ttlMs
    for (const p of relPaths) this.suppressed.set(p, expiry)
  }

  /** Exposed for the real-chokidar integration test's deterministic flush. */
  handleBatch(events: readonly BatchedEvent[]): void {
    if (this.stopped) return
    try {
      this.routeBatch(events)
    } catch (err) {
      // Previously an UNCAUGHT main-process exception (EventBatcher's
      // setTimeout flush) or a throw propagating into stopApprovals (the
      // stop()-time synchronous flush). Contracts §4 v1.2.1: audit, degrade
      // visibly, keep processing later batches.
      const message = err instanceof Error ? err.message : String(err)
      this.auditGateFailure('batch processing failed', message, this.relPaths(events))
      this.setHealth('degraded', `batch processing failed: ${message}`)
    }
  }

  private routeBatch(events: readonly BatchedEvent[]): void {
    const now = this.deps.now?.() ?? Date.now()
    const live = events.filter((e) => !this.isSuppressed(relative(this.deps.root, e.path), now))
    if (live.length === 0) return
    const match = this.deps.registry.activeTurnFor(this.deps.root, this.deps.now?.())
    const parts = partitionBatch(live, {
      isSelfWrite: this.deps.isSelfWrite,
      turn: match,
      forbiddenMatcher: isHarnessProtectedPath,
      root: this.deps.root
    })

    if (parts.forbidden.length > 0) {
      const paths = this.relPaths(parts.forbidden)
      if (match !== null) {
        // A rejected autoReject promise was previously discarded (`void`) —
        // an invisible containment failure. Audit + degrade instead.
        this.deps.queue
          .autoReject(
            {
              turnId: match.turn.turnId,
              threadId: match.turn.threadId,
              agentId: match.turn.agentId,
              paths
            },
            this.deps.root
          )
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err)
            this.auditGateFailure('auto-reject failed', message, paths)
            this.setHealth('degraded', `auto-reject failed: ${message}`)
          })
        // Breaker signal (step 6): one observation per forbidden batch —
        // repeated protected-path hits within a turn escalate to a kill.
        this.deps.breaker?.noteForbiddenAutoReject({
          threadId: match.turn.threadId,
          agentId: match.turn.agentId,
          turnId: match.turn.turnId,
          concurrentTurns: match.concurrent
        })
      } else {
        // No window to attribute the violation to — contain nothing (we
        // cannot name an agent), but never let it pass silently.
        this.auditUnattributed(paths, 'harness-protected path touched outside any turn window')
      }
    }

    if (parts.attributed.length > 0 && match !== null) {
      const paths = this.relPaths(parts.attributed)
      const limiter = this.limiterFor(match.turn.threadId)
      // Aggregate (root, slug) limiter (step 5): opt-in via the budgets
      // snapshot. When the field is absent the slug limiter is neither
      // created, recorded into, nor evaluated — routing is byte-identical.
      // Keyed by the BINDING slug (attribution authority), never the turn's
      // possibly-degraded agentId (v1.3.4 review fix).
      const slugBudget = this.deps.getSlugWriteBudget?.(match.turn.threadId)
      const slugLimiter = slugBudget !== undefined ? this.slugLimiterFor(slugBudget.slug) : null
      for (const _ of paths) {
        limiter.record()
        slugLimiter?.record()
      }
      const headMoved = isAgentHeadMove(
        match.turn,
        this.deps.headSha(this.deps.root),
        this.deps.commitsBetween
      )
      if (headMoved && !this.headMovedAudited.has(match.turn.turnId)) {
        this.headMovedAudited.add(match.turn.turnId)
        this.auditHeadMoved(match.turn)
        // Breaker signal (step 6): once per turn, aligned with the audit.
        this.deps.breaker?.noteHeadMoved({
          threadId: match.turn.threadId,
          agentId: match.turn.agentId,
          turnId: match.turn.turnId,
          concurrentTurns: match.concurrent
        })
      }
      // Per-thread threshold from the bound harness's bind-time budgets
      // snapshot; DEFAULT for unbound/ad-hoc threads (step 6).
      const threshold =
        this.deps.getWriteBudget?.(match.turn.threadId) ?? DEFAULT_MAX_WRITES_PER_MINUTE
      const slugExceeded =
        slugLimiter !== null &&
        slugBudget !== undefined &&
        slugLimiter.isExceeded(slugBudget.maxWritesPerMinute)
      const flags: Partial<PendingChangeFlags> = {
        // "Write rate exceeded a configured ceiling" — the per-thread
        // threshold or (opt-in, step 5) the slug aggregate.
        highVelocity: limiter.isExceeded(threshold) || slugExceeded,
        headMoved,
        concurrentTurns: match.concurrent,
        degradedAttribution: match.degraded,
        gateDegraded: match.turn.gateDegradedAtStart === true,
        attributionSuspect: match.attributionSuspect
      }
      // capturedRoot = the watcher's OWN root (the autoReject expectedRoot
      // discipline): a batch flushing after a workspace switch flipped
      // getRoot() must bind to the tree it was captured against, never the
      // new active root (v1.3.0 root-binding invariant).
      this.deps.queue.recordWrites({
        turnId: match.turn.turnId,
        threadId: match.turn.threadId,
        agentId: match.turn.agentId,
        paths,
        flags,
        capturedRoot: this.deps.root
      })
      // Breaker signal (step 6): one velocity observation per attributed
      // batch — consecutive exceeded observations trip, a single one only
      // flags. Sent AFTER recordWrites so a kill can never race the queue
      // item that documents the writes that caused it.
      this.deps.breaker?.noteVelocity({
        threadId: match.turn.threadId,
        agentId: match.turn.agentId,
        turnId: match.turn.turnId,
        concurrentTurns: match.concurrent,
        exceeded: flags.highVelocity === true
      })
    }

    if (parts.unattributed.length > 0) {
      this.auditUnattributed(this.relPaths(parts.unattributed), 'write outside any turn window')
    }
  }

  private isSuppressed(relPath: string, now: number): boolean {
    const expiry = this.suppressed.get(relPath)
    if (expiry === undefined) return false
    if (now > expiry) {
      this.suppressed.delete(relPath)
      return false
    }
    return true
  }

  /** One audit entry per turn when the agent-ran-git tripwire trips. */
  private auditHeadMoved(turn: ActiveTurnMatch['turn']): void {
    this.deps.audit.log({
      ts: new Date(this.deps.now?.() ?? Date.now()).toISOString(),
      tool: 'cli-agent:head-moved',
      args: {
        turnId: turn.turnId,
        threadId: turn.threadId,
        agentId: turn.agentId,
        headShaAtStart: turn.headShaAtStart ?? null,
        headShaNow: this.deps.headSha(this.deps.root) ?? null
      },
      affectedPaths: [],
      decision: 'error',
      error: 'git HEAD moved during agent turn'
    })
  }

  private limiterFor(threadId: string): WriteRateLimiter {
    const existing = this.limiters.get(threadId)
    if (existing !== undefined) return existing
    const limiter = new WriteRateLimiter()
    this.limiters.set(threadId, limiter)
    return limiter
  }

  private slugLimiterFor(slug: string): WriteRateLimiter {
    const existing = this.slugLimiters.get(slug)
    if (existing !== undefined) return existing
    const limiter = new WriteRateLimiter()
    this.slugLimiters.set(slug, limiter)
    return limiter
  }

  private relPaths(events: readonly BatchedEvent[]): readonly string[] {
    return events.map((e) => relative(this.deps.root, e.path))
  }

  /**
   * Escapes are logged, never silent (contracts §4). decision 'error' marks
   * these as anomalies — nothing was allowed or denied; the write simply
   * happened outside the gate's reach.
   */
  private auditUnattributed(paths: readonly string[], reason: string): void {
    this.deps.audit.log({
      ts: new Date(this.deps.now?.() ?? Date.now()).toISOString(),
      tool: 'cli-agent:unattributed-write',
      args: { reason },
      affectedPaths: [...paths],
      decision: 'error',
      error: reason
    })
  }

  /**
   * The gate's OWN machinery failed (chokidar error, batch throw, rejected
   * auto-reject, failed start). Same anomaly shape as auditUnattributed:
   * decision 'error' — nothing was allowed or denied, coverage broke.
   */
  private auditGateFailure(reason: string, detail: string, paths: readonly string[]): void {
    this.deps.audit.log({
      ts: new Date(this.deps.now?.() ?? Date.now()).toISOString(),
      tool: 'cli-agent:watcher-failure',
      args: { reason, detail },
      affectedPaths: [...paths],
      decision: 'error',
      error: `${reason}: ${detail}`
    })
  }
}
