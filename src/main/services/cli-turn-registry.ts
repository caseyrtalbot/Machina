/**
 * CLI turn registry (workstation step 3, contracts §4 v1.1.1).
 *
 * The attribution primitive for the post-persistence gate: a Map of
 * threadId → the thread's most recent turn window. The spawner opens a
 * window when it sends an invocation into the PTY; the thread bridge closes
 * it on block completion. `AgentWriteWatcher` asks `activeTurnFor(root)`
 * which turn (if any) owns a filesystem event.
 *
 * Window semantics (each traceable to a §4 contract point):
 *  - A closed turn stays attributable for LINGER_MS after `turnEnded` —
 *    covers the watcher's awaitWriteFinish (300ms) + batch lag, so writes in
 *    the last moments of a turn do not escape.
 *  - Degraded mode: shell hooks are required for block events; when none has
 *    EVER arrived for a thread (DEGRADED_AFTER_MS after turn start), the
 *    window falls back to PTY-alive attribution with `degraded: true`.
 *    Silently attributing nothing is the failure mode — over-flagging a
 *    long first turn is accepted and documented.
 *  - `concurrent: true` when more than one turn window qualifies for the
 *    same root — ambiguous attribution, surfaced as a queue flag.
 *
 * Dependencies (head sha capture, PTY liveness, clock) are injected so the
 * registry unit-tests without git or PTYs.
 */
import { randomUUID } from 'node:crypto'
import { sep } from 'path'
import { canonicalizePath } from '../utils/paths'
import { headSha } from './git-service'

/** Closed turns remain attributable this long after turnEnded. */
export const LINGER_MS = 1500
/** With zero block events ever for a thread, fall back to PTY-alive attribution. */
export const DEGRADED_AFTER_MS = 30_000

export interface CliTurn {
  /**
   * Run-unique id (`t<seq>-<run tag>`); the queue coalesces writes into
   * `pc_<turnId>`. The random per-registry tag is load-bearing (v1.3.0): the
   * queue's disk mirror rehydrates items under their ORIGINAL ids, so a
   * bare per-run counter would let this run's first turn collide with a
   * persisted `pc_t1` from an earlier run and coalesce writes across
   * runs/roots.
   */
  readonly turnId: string
  readonly threadId: string
  /** Harness slug when provided (step 6 seam), else the adapter identity. */
  readonly agentId: string
  readonly cwd: string
  /**
   * HEAD at send time (post pre-agent snapshot); null in non-repo cwds.
   * IMMUTABLE for the life of the turn — the headMoved tripwire's baseline.
   * Queue-made approval commits are excused via `queueCommitShas`, never by
   * rebaselining (a rebaseline would erase evidence of an agent commit that
   * happened before the user's mid-turn approval).
   */
  readonly headShaAtStart: string | null
  /** Shas of approval commits the QUEUE made during this turn (user action). */
  readonly queueCommitShas: readonly string[]
  readonly startedAt: number
  readonly endedAt: number | null
  /**
   * Turn opened while the agent-write watcher state ∉ {watching} (contracts §4
   * v1.2.1, OQ6: visibly degrade, never block). Optional so existing test
   * literals stay valid; turnStarted always sets it.
   */
  readonly gateDegradedAtStart?: boolean
  /**
   * The turn's requested agentId failed main-side binding validation
   * (contracts §4 v1.2.2): malformed, binding mismatch, or forwarded on an
   * unbound thread. Attribution already fell back to adapter identity; this
   * tag flows into the queue item's attributionSuspect flag. Optional so
   * existing test literals stay valid; turnStarted always sets it.
   */
  readonly attributionSuspect?: boolean
}

/**
 * Pure: did the AGENT move HEAD during this turn? False when HEAD is
 * unchanged, or when every commit between the turn's baseline and HEAD-now
 * is one the queue itself made. A failed walk (null from commitsBetween —
 * e.g. the baseline was made unreachable by `git reset`) counts as moved:
 * history rewriting is exactly what the tripwire exists to surface.
 */
export function isAgentHeadMove(
  turn: Pick<CliTurn, 'headShaAtStart' | 'queueCommitShas' | 'cwd'>,
  headNow: string | null,
  commitsBetween: (root: string, from: string, to: string) => readonly string[] | null
): boolean {
  if (headNow === turn.headShaAtStart) return false
  if (turn.headShaAtStart === null || headNow === null) return true
  const between = commitsBetween(turn.cwd, turn.headShaAtStart, headNow)
  if (between === null) return true
  return between.some((sha) => !turn.queueCommitShas.includes(sha))
}

export interface ActiveTurnMatch {
  readonly turn: CliTurn
  /** More than one turn window qualified — ambiguous attribution. */
  readonly concurrent: boolean
  /** Attributed via the PTY-alive fallback (no block events for the thread). */
  readonly degraded: boolean
  /** The turn's requested agentId failed binding validation (v1.2.2). */
  readonly attributionSuspect: boolean
}

export interface TurnStartedOpts {
  readonly threadId: string
  readonly agentId: string
  readonly cwd: string
  /** Set by the IPC boundary when binding validation degraded (v1.2.2). */
  readonly attributionSuspect?: boolean
}

/** Surfaced to the step-6 breaker wiring on every turn open (contracts §5). */
export interface TurnStartedInfo {
  readonly threadId: string
  readonly agentId: string
  readonly cwd: string
  /**
   * CLI invocations sent for this thread so far, INCLUDING this one (OQ2:
   * the maxTurns unit). In-memory per app run — a relaunch resets counts,
   * same lifetime as every other registry fact. Deliberately NOT reset by
   * threadClosed: a breaker kill must not refill the budget.
   */
  readonly invocationCount: number
}

export interface CliTurnRegistryDeps {
  /** GitService.headSha — null for non-repo roots. */
  readonly headSha: (root: string) => string | null
  /** True when the thread's PTY is still alive (degraded-mode window). */
  readonly isPtyAlive: (threadId: string) => boolean
  /**
   * True when the agent-write watcher state is 'watching' (contracts §4
   * v1.2.1). Absent = assume healthy — turns must never be blocked or falsely
   * flagged when the probe is unwired (tests, early boot).
   */
  readonly isGateHealthy?: () => boolean
  /**
   * Fired on every turnStarted with the thread's running invocation count
   * (step 6, contracts §5 v1.2.6): the breaker wiring in ipc/cli-thread.ts
   * checks it against the bound harness's maxTurns budget. Injected-callback
   * style (same as step 2's onHealthChange) — the registry never learns
   * budgets or kills anything itself.
   */
  readonly onTurnStarted?: (info: TurnStartedInfo) => void
  /** Injectable clock (ms epoch) for deterministic tests. */
  readonly now?: () => number
}

export class CliTurnRegistry {
  /** threadId → most recent turn. One live window per thread by design. */
  private readonly turns = new Map<string, CliTurn>()
  /**
   * Threads that have EVER received a block-completion event. Once a thread
   * proves its hooks emit blocks, it never re-enters degraded mode this run.
   */
  private readonly sawTurnEnd = new Set<string>()
  /**
   * Invocations sent minus block completions seen, per thread. A cancelled
   * turn's late block event must close ITS OWN send, not the follow-up turn
   * the user already started — turnEnded only stamps the current turn when
   * this count drains to zero. Over-counting (a cancelled invocation that
   * never produces a block) leaves the window open, which degrades safely:
   * over-attribution, never silent escape.
   */
  private readonly openInvocations = new Map<string, number>()
  /**
   * Total invocations sent per thread this app run (step 6, the maxTurns
   * unit — OQ2). Survives threadClosed on purpose: a breaker kill or PTY
   * death must not refill the thread's budget.
   */
  private readonly invocationCounts = new Map<string, number>()
  private seq = 0
  /** Per-registry (= per-app-run) tag making turnIds run-unique — see CliTurn.turnId. */
  private readonly runTag = randomUUID().slice(0, 8)

  constructor(private readonly deps: CliTurnRegistryDeps) {}

  /** Open a turn window; called by the spawner at send time. */
  turnStarted(opts: TurnStartedOpts): CliTurn {
    this.seq += 1
    const turn: CliTurn = {
      turnId: `t${this.seq}-${this.runTag}`,
      threadId: opts.threadId,
      agentId: opts.agentId,
      cwd: opts.cwd,
      headShaAtStart: this.deps.headSha(opts.cwd),
      queueCommitShas: [],
      startedAt: this.now(),
      endedAt: null,
      // OQ6 (visibly degrade, never block): the turn proceeds regardless; the
      // tag just flows into the queue item's gateDegraded flag.
      gateDegradedAtStart: !(this.deps.isGateHealthy?.() ?? true),
      attributionSuspect: opts.attributionSuspect === true
    }
    this.turns.set(opts.threadId, turn)
    this.openInvocations.set(opts.threadId, (this.openInvocations.get(opts.threadId) ?? 0) + 1)
    const invocationCount = (this.invocationCounts.get(opts.threadId) ?? 0) + 1
    this.invocationCounts.set(opts.threadId, invocationCount)
    this.deps.onTurnStarted?.({
      threadId: opts.threadId,
      agentId: opts.agentId,
      cwd: opts.cwd,
      invocationCount
    })
    return turn
  }

  /**
   * Record a block completion (bridge callback). Closes the thread's current
   * window only when every sent invocation has completed, and returns the
   * closed turn so the caller can run end-of-turn checks (headMoved).
   */
  turnEnded(threadId: string): CliTurn | undefined {
    this.sawTurnEnd.add(threadId)
    const remaining = Math.max(0, (this.openInvocations.get(threadId) ?? 0) - 1)
    this.openInvocations.set(threadId, remaining)
    if (remaining > 0) return undefined
    const turn = this.turns.get(threadId)
    if (turn === undefined || turn.endedAt !== null) return undefined
    const closed: CliTurn = { ...turn, endedAt: this.now() }
    this.turns.set(threadId, closed)
    return closed
  }

  /**
   * Drop the thread's window immediately — no linger. A killed PTY cannot
   * write any more; keeping the window open would misattribute user edits.
   * (Trailing fs events already in flight — ~400ms of watcher lag — become
   * audited unattributed writes: accepted, the reverse trade is worse.)
   * `sawTurnEnd` survives: hook presence is a per-thread fact for this run.
   */
  threadClosed(threadId: string): void {
    this.turns.delete(threadId)
    this.openInvocations.delete(threadId)
  }

  /**
   * Record an approval commit the QUEUE made during the thread's current
   * turn. The baseline stays immutable; the tripwire excuses exactly these
   * shas when deciding whether HEAD movement was agent-caused.
   */
  noteQueueCommit(threadId: string, sha: string): void {
    const turn = this.turns.get(threadId)
    if (turn === undefined) return
    this.turns.set(threadId, { ...turn, queueCommitShas: [...turn.queueCommitShas, sha] })
  }

  /**
   * Record a commit the GATE itself made that is not tied to one thread — a
   * step-5 wholesale revert (v1.2.7). Excuses `sha` on EVERY turn window
   * under `root` (same containment predicate as activeTurnFor), so the
   * headMoved tripwire never reads the gate's own revert commit as an agent
   * HEAD move. Baselines stay immutable — this is excusal, not rebaselining.
   */
  noteGateCommitForRoot(root: string, sha: string): void {
    for (const [threadId, turn] of this.turns) {
      if (!isInside(root, turn.cwd)) continue
      this.turns.set(threadId, { ...turn, queueCommitShas: [...turn.queueCommitShas, sha] })
    }
  }

  /**
   * The turn window that owns a filesystem event under `root` right now, or
   * null. Most-recent `startedAt` wins when several qualify (`concurrent`
   * reports the ambiguity).
   */
  activeTurnFor(root: string, nowMs?: number): ActiveTurnMatch | null {
    const now = nowMs ?? this.now()
    const qualifying: { turn: CliTurn; degraded: boolean }[] = []
    for (const turn of this.turns.values()) {
      if (!isInside(root, turn.cwd)) continue
      const state = this.windowState(turn, now)
      if (state !== null) qualifying.push({ turn, degraded: state.degraded })
    }
    if (qualifying.length === 0) return null
    const best = qualifying.reduce((a, b) => (b.turn.startedAt >= a.turn.startedAt ? b : a))
    return {
      turn: best.turn,
      concurrent: qualifying.length > 1,
      degraded: best.degraded,
      attributionSuspect: best.turn.attributionSuspect === true
    }
  }

  private windowState(turn: CliTurn, now: number): { degraded: boolean } | null {
    if (turn.endedAt !== null) {
      // Closed: attributable through the linger window, never degraded
      // (an endedAt implies a block event arrived).
      return now - turn.endedAt <= LINGER_MS ? { degraded: false } : null
    }
    // EVERY open window requires a living PTY: a shell that crashed mid-turn
    // produces neither turnEnded nor threadClosed, and an unbounded window on
    // a dead thread would swallow user edits forever.
    if (!this.deps.isPtyAlive(turn.threadId)) return null
    // The thread has proven its hooks emit block events (or the turn is
    // young enough that the block may simply not have completed yet).
    if (this.sawTurnEnd.has(turn.threadId) || now - turn.startedAt < DEGRADED_AFTER_MS) {
      return { degraded: false }
    }
    // No block event has ever arrived for this thread: hooks are presumed
    // absent — PTY-alive attribution, flagged degraded.
    return { degraded: true }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }
}

/**
 * Memoized realpath canonicalization for the containment identity checks
 * below. The registry sees a handful of distinct strings per run (workspace
 * roots + per-turn cwds), so the map stays tiny; memoization keeps the
 * per-batch `activeTurnFor` walk off the filesystem.
 */
const canonicalMemo = new Map<string, string>()
function canonical(path: string): string {
  const hit = canonicalMemo.get(path)
  if (hit !== undefined) return hit
  const result = canonicalizePath(path)
  canonicalMemo.set(path, result)
  return result
}

/**
 * True when `child` is `root` or a descendant of it (path-segment safe).
 * PATH identity, not string identity (v1.2.7): both sides are realpath-
 * canonicalized before comparison. WorkspaceService canonicalizes the root
 * it hands the agent-write watcher (`/var/...` → `/private/var/...` on
 * macOS), but the turn cwd arrives from the caller verbatim — comparing raw
 * strings silently detached every turn window from the watcher root on any
 * symlink-aliased workspace path, routing all agent writes to
 * "outside any turn window": no queue capture, no velocity/forbidden
 * signals, no breaker coverage.
 */
function isInside(root: string, child: string): boolean {
  const r = canonical(root)
  const c = canonical(child)
  return c === r || c.startsWith(r + sep)
}

// ── Singleton wiring ─────────────────────────────────────────────────────
// The PTY-alive probe is late-bound: the spawner (ipc/cli-thread.ts) owns the
// threadId → sessionId map but transitively imports ipc/shell.ts, which needs
// the registry for the bridge's onTurnComplete — a setter breaks the cycle.

let ptyAliveProbe: ((threadId: string) => boolean) | null = null
let gateHealthProbe: (() => boolean) | null = null
let turnStartedListener: ((info: TurnStartedInfo) => void) | null = null
let singleton: CliTurnRegistry | null = null

export function setPtyAliveProbe(probe: (threadId: string) => boolean): void {
  ptyAliveProbe = probe
}

/**
 * Late-bound like the probes above: ipc/cli-thread.ts owns the breaker/budget
 * wiring but transitively reaches this module — a setter breaks the cycle.
 * Unwired = no-op (tests, early boot); turns are never blocked either way.
 */
export function setTurnStartedListener(listener: (info: TurnStartedInfo) => void): void {
  turnStartedListener = listener
}

/**
 * Late-bound like the PTY probe: ipc/git.ts owns the watcher-health state but
 * imports this module (getCliTurnRegistry) — a direct import back would be a
 * cycle. Wired in registerGitIpc; unwired defaults to healthy (never
 * false-flag turns before the approvals surface exists).
 */
export function setGateHealthProbe(probe: () => boolean): void {
  gateHealthProbe = probe
}

export function getCliTurnRegistry(): CliTurnRegistry {
  if (singleton === null) {
    singleton = new CliTurnRegistry({
      headSha,
      isPtyAlive: (threadId) => ptyAliveProbe?.(threadId) ?? false,
      isGateHealthy: () => gateHealthProbe?.() ?? true,
      onTurnStarted: (info) => turnStartedListener?.(info)
    })
  }
  return singleton
}
