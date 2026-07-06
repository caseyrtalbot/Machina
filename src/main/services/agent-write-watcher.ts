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
import type { GitOpResult, PendingChange, PendingChangeFlags } from '@shared/git-types'
import { EventBatcher, type BatchedEvent } from './event-batcher'
import { WriteRateLimiter } from './hitl-gate'
import { isAgentHeadMove, type ActiveTurnMatch } from './cli-turn-registry'
import type { RecordWritesOpts } from './approval-queue'

/** Mirrors vault-watcher's batching interval. */
const BATCH_INTERVAL_MS = 50
/** Contracts §5 default budget: maxWritesPerMinute. */
const MAX_WRITES_PER_MINUTE = 10

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

export interface AgentWriteWatcherDeps {
  readonly root: string
  readonly registry: {
    activeTurnFor(root: string, nowMs?: number): ActiveTurnMatch | null
  }
  readonly queue: {
    recordWrites(opts: RecordWritesOpts): PendingChange
    autoReject(opts: RecordWritesOpts, expectedRoot?: string): Promise<GitOpResult>
  }
  readonly audit: { log(entry: AuditEntry): void }
  readonly isSelfWrite: (absPath: string) => boolean
  /** GitService.headSha — the headMoved (agent-ran-git) tripwire. */
  readonly headSha: (root: string) => string | null
  /** GitService.commitsBetween — excuses the queue's own approval commits. */
  readonly commitsBetween: (root: string, from: string, to: string) => readonly string[] | null
  readonly now?: () => number
}

export class AgentWriteWatcher {
  private watcher: FSWatcher | null = null
  private batcher: EventBatcher | null = null
  /** Disarmed before the batcher's synchronous final flush in stop(). */
  private stopped = false
  /** Per-thread write velocity → the highVelocity flag. */
  private readonly limiters = new Map<string, WriteRateLimiter>()
  /** relPath → suppression expiry (ms epoch) for the gate's own git/trash ops. */
  private readonly suppressed = new Map<string, number>()
  /** Turns whose headMoved tripwire already produced its one audit entry. */
  private readonly headMovedAudited = new Set<string>()

  constructor(private readonly deps: AgentWriteWatcherDeps) {}

  /**
   * Start watching and resolve once chokidar's initial scan is complete.
   * Writes landing mid-scan are treated as pre-existing by `ignoreInitial`
   * and silently swallowed — callers that need deterministic coverage from
   * a known point (tests, future health checks) must await this.
   */
  async start(): Promise<void> {
    await this.stop()
    this.stopped = false
    this.batcher = new EventBatcher((events) => this.handleBatch(events), BATCH_INTERVAL_MS)
    this.watcher = watch(this.deps.root, {
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
    this.watcher
      .on('add', enqueue('add'))
      .on('change', enqueue('change'))
      .on('unlink', enqueue('unlink'))
      .on('error', (err) => {
        // An unhandled 'error' on the FSWatcher EventEmitter becomes an
        // uncaughtException (crash dialog + silently dead gate). Log and
        // keep whatever chokidar can still deliver.
        console.error('[agent-write-watcher] watcher error', err)
      })
    const watcher = this.watcher
    await new Promise<void>((resolveReady) => watcher.once('ready', () => resolveReady()))
  }

  async stop(): Promise<void> {
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
        void this.deps.queue.autoReject(
          {
            turnId: match.turn.turnId,
            threadId: match.turn.threadId,
            agentId: match.turn.agentId,
            paths
          },
          this.deps.root
        )
      } else {
        // No window to attribute the violation to — contain nothing (we
        // cannot name an agent), but never let it pass silently.
        this.auditUnattributed(paths, 'harness-protected path touched outside any turn window')
      }
    }

    if (parts.attributed.length > 0 && match !== null) {
      const paths = this.relPaths(parts.attributed)
      const limiter = this.limiterFor(match.turn.threadId)
      for (const _ of paths) limiter.record()
      const headMoved = isAgentHeadMove(
        match.turn,
        this.deps.headSha(this.deps.root),
        this.deps.commitsBetween
      )
      if (headMoved && !this.headMovedAudited.has(match.turn.turnId)) {
        this.headMovedAudited.add(match.turn.turnId)
        this.auditHeadMoved(match.turn)
      }
      const flags: Partial<PendingChangeFlags> = {
        highVelocity: limiter.isExceeded(MAX_WRITES_PER_MINUTE),
        headMoved,
        concurrentTurns: match.concurrent,
        degradedAttribution: match.degraded
      }
      this.deps.queue.recordWrites({
        turnId: match.turn.turnId,
        threadId: match.turn.threadId,
        agentId: match.turn.agentId,
        paths,
        flags
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
}
