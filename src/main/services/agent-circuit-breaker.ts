/**
 * Agent circuit breaker (workstation Phase 2 step 6, contracts §5 v1.2.6).
 *
 * Escalates the gate's ADVISORY signals to a hard PTY kill, inside the §4
 * containment framing: breakers contain accidents FASTER; they never claim
 * prevention. The writes that tripped a breaker are already on disk and stay
 * owned by the approvals queue — killing the PTY just stops the tap.
 *
 * Trip inputs (each keyed threadId/agentId):
 *   - velocity: VELOCITY_TRIP_CONSECUTIVE consecutive limiter-exceeded batch
 *     observations from the write watcher — never a single window; one burst
 *     flags `highVelocity`, only a SUSTAINED burst trips;
 *   - forbidden-writes: FORBIDDEN_TRIP_PER_TURN protected-glob autoRejects
 *     within one turn (repeated containment hits, not one);
 *   - head-moved: the agent-ran-git tripwire (one audit per turn — one
 *     signal per turn); NOTICE class since v1.2.7 — see negative rule 3;
 *   - max-turns: the thread's invocation count exceeded its bound harness
 *     budget (surfaced by CliTurnRegistry via ipc/cli-thread.ts).
 *
 * Trip action = injected kill (spawner.close: PTY killed, turn window
 * dropped with zero linger) + audit entry + `agent:breaker-tripped` event.
 * Kill runs EXACTLY ONCE per trip episode (per-thread latch; the latch and
 * counters reset when the thread's next turn opens — an explicit user send
 * is re-engagement).
 *
 * Negative rules (contracts §5 v1.2.6, judge grafts — test-pinned):
 *   1. NEVER trips on watcher-degraded state alone. Health is consumed only
 *      for status honesty (`signalsDegraded`): a dead watcher silences the
 *      velocity/forbidden/headMoved sources, and the breaker says so instead
 *      of pretending coverage — it must not kill healthy agents on silence.
 *   2. NEVER auto-kills on signals from writes flagged `concurrentTurns`:
 *      ambiguous attribution could kill the wrong agent. The trip degrades
 *      to a tray notice (`action: 'notice'`, audited + broadcast, kill left
 *      manual). A later unambiguous signal may still escalate to a kill —
 *      still exactly one kill per episode.
 *   3. NEVER kills on a bare headMoved signal (§8 v1.2.7, orchestrator
 *      decision from the post-merge review): the user's own `git commit` /
 *      `pull` / `checkout` in their terminal during a writing turn is an
 *      everyday event this channel cannot distinguish from agent git
 *      activity. headMoved joins the concurrentTurns notice-latch class —
 *      notice + audit + tray row on the first signal; the episode escalates
 *      to its single kill only on a later unambiguous KILL-CLASS signal
 *      (velocity/forbidden/max-turns). The watcher's head-moved audit entry
 *      and the queue's headMoved flag are untouched by this degrade.
 *
 * Kill-vs-awaitWriteFinish semantics (recorded, tested): writes still
 * flushing within the watcher's ~300ms awaitWriteFinish window after the
 * kill arrive AFTER threadClosed dropped the turn window with zero linger —
 * they become audited unattributed writes, never silent (the §4 trade).
 */
import { join } from 'node:path'
import { app } from 'electron'
import type {
  AgentBreakerStatus,
  BreakerAction,
  BreakerReason,
  BreakerTripEvent
} from '../../shared/agent-breaker-types'
import type { AuditEntry } from '../../shared/agent-types'
import { AuditLogger } from './audit-logger'

/** Consecutive limiter-exceeded batch observations before a velocity trip. */
export const VELOCITY_TRIP_CONSECUTIVE = 3
/** Protected-glob autoRejects within one turn before a forbidden-writes trip. */
export const FORBIDDEN_TRIP_PER_TURN = 3

/** A watcher-sourced signal — carries the batch's attribution ambiguity. */
export interface BreakerSignal {
  readonly threadId: string
  readonly agentId: string
  readonly turnId: string
  /** The batch matched >1 turn window — ambiguous attribution (never kill). */
  readonly concurrentTurns: boolean
}

export interface AgentCircuitBreakerDeps {
  readonly audit: { log(entry: AuditEntry): void }
  /** The hard-kill path (spawner.close via the late-bound singleton wiring). */
  readonly kill: (threadId: string) => void
  /** IPC broadcast of the trip (tray notice row, kill-switch chip). */
  readonly emit?: (event: BreakerTripEvent) => void
  /** Step-2 watcher health: true when watcher-sourced signals have coverage. */
  readonly isSignalSourceHealthy?: () => boolean
  readonly now?: () => number
}

interface ThreadBreakerState {
  agentId: string
  /** Consecutive limiter-exceeded batches (reset by a non-exceeded batch). */
  consecutiveVelocity: number
  /** Forbidden autoRejects seen for the current turn. */
  forbiddenTurnId: string | null
  forbiddenCount: number
  /**
   * Latest cost observation only — observability, not accounting (the
   * durable accumulators are the bridge map and the AgentCostLedger).
   * Wiped by noteTurnStarted's freshState like everything else; correct
   * because it is a snapshot, not a counter (step 5, contracts v1.3.4).
   */
  lastCost?: { readonly turnCostUsd: number; readonly cumulativeUsd: number }
  /** Latched trip for the current episode; null until tripped. */
  trip: BreakerTripEvent | null
}

export class AgentCircuitBreaker {
  private readonly byThread = new Map<string, ThreadBreakerState>()

  constructor(private readonly deps: AgentCircuitBreakerDeps) {}

  /**
   * A new turn opened for the thread (explicit user send = re-engagement):
   * reset the episode — counters and the trip latch. A still-breached
   * maxTurns budget re-trips immediately on the same turn's count signal;
   * that repeat kill is the budget holding, not a double kill.
   */
  noteTurnStarted(info: { threadId: string; agentId: string }): void {
    this.byThread.set(info.threadId, freshState(info.agentId))
  }

  /** One observation per attributed watcher batch. */
  noteVelocity(signal: BreakerSignal & { exceeded: boolean }): void {
    const state = this.stateFor(signal.threadId, signal.agentId)
    if (state.trip?.action === 'killed') return
    if (!signal.exceeded) {
      state.consecutiveVelocity = 0
      return
    }
    state.consecutiveVelocity += 1
    if (state.consecutiveVelocity >= VELOCITY_TRIP_CONSECUTIVE) {
      this.trip(
        state,
        signal,
        'velocity',
        `write-rate limiter exceeded on ${state.consecutiveVelocity} consecutive batches (turn ${signal.turnId})`
      )
    }
  }

  /** One observation per forbidden (HARNESS_PROTECTED_GLOBS) autoReject batch. */
  noteForbiddenAutoReject(signal: BreakerSignal): void {
    const state = this.stateFor(signal.threadId, signal.agentId)
    if (state.trip?.action === 'killed') return
    if (state.forbiddenTurnId !== signal.turnId) {
      state.forbiddenTurnId = signal.turnId
      state.forbiddenCount = 0
    }
    state.forbiddenCount += 1
    if (state.forbiddenCount >= FORBIDDEN_TRIP_PER_TURN) {
      this.trip(
        state,
        signal,
        'forbidden-writes',
        `${state.forbiddenCount} protected-path auto-rejects in turn ${signal.turnId}`
      )
    }
  }

  /**
   * The agent-ran-git tripwire fired (once per turn from the watcher).
   * Notice class (negative rule 3, §8 v1.2.7): a bare HEAD move is
   * indistinguishable from the user's own git activity — never a kill on
   * its own, regardless of `concurrentTurns`.
   */
  noteHeadMoved(signal: BreakerSignal): void {
    const state = this.stateFor(signal.threadId, signal.agentId)
    if (state.trip?.action === 'killed') return
    this.trip(state, signal, 'head-moved', `git HEAD moved during turn ${signal.turnId}`, {
      noticeOnly: true
    })
  }

  /**
   * The thread's invocation count exceeded its bound harness budget.
   * `scope` (step 5): absent = 'thread' (per-thread maxTurns, unchanged);
   * 'slug' = the per-(root, slug) aggregate ceiling (maxTurnsPerSlug). The
   * reason stays 'max-turns' either way — the detail string disambiguates.
   */
  noteMaxTurns(info: {
    threadId: string
    agentId: string
    invocationCount: number
    maxTurns: number
    scope?: 'thread' | 'slug'
  }): void {
    const state = this.stateFor(info.threadId, info.agentId)
    if (state.trip?.action === 'killed') return
    this.trip(
      state,
      // Registry-side counting of explicit sends is per-thread and
      // unambiguous — never concurrent-flagged.
      { threadId: info.threadId, agentId: info.agentId, turnId: '', concurrentTurns: false },
      'max-turns',
      info.scope === 'slug'
        ? `slug aggregate invocation ${info.invocationCount} exceeded the harness maxTurnsPerSlug budget (${info.maxTurns})`
        : `invocation ${info.invocationCount} exceeded the harness maxTurns budget (${info.maxTurns})`
    )
  }

  /**
   * One observed cost delta for a completed turn (step 5, contracts v1.3.4).
   * NOTICE-CLASS ONLY, structurally kill-incapable: the single trip site
   * below passes `noticeOnly: true` unconditionally — there is no code path
   * from noteCost to `action: 'killed'`. No step-5 production caller supplies
   * `maxSpendUsd`; step 6's loop wiring does (present + breached ⇒ notice
   * trip — kept so the notice class is testable now). Never called for
   * cost-unobservable adapters (codex/gemini/raw): unobserved is flagged by
   * the contracts matrix, never zeroed into a spend of $0.
   */
  noteCost(info: {
    threadId: string
    agentId: string
    turnCostUsd: number
    cumulativeUsd: number
    maxSpendUsd?: number
  }): void {
    const state = this.stateFor(info.threadId, info.agentId)
    state.lastCost = { turnCostUsd: info.turnCostUsd, cumulativeUsd: info.cumulativeUsd }
    if (state.trip?.action === 'killed') return
    if (info.maxSpendUsd === undefined || info.cumulativeUsd <= info.maxSpendUsd) return
    this.trip(
      state,
      { threadId: info.threadId, agentId: info.agentId, turnId: '', concurrentTurns: false },
      'max-spend',
      `cumulative observed spend $${info.cumulativeUsd} crossed the maxSpendUsd threshold ($${info.maxSpendUsd})`,
      // The forced-notice pattern (noteHeadMoved): a spend threshold is a
      // visibility line, not a containment action — the disarm ACTION lives
      // in step 6's LoopRegistry, never a kill until calibrated.
      { noticeOnly: true }
    )
  }

  /** Latest cost observation for a thread — observability read, never $0 for unseen. */
  lastCostFor(
    threadId: string
  ): { readonly turnCostUsd: number; readonly cumulativeUsd: number } | undefined {
    return this.byThread.get(threadId)?.lastCost
  }

  /** Pull mirror for the tray/chip (`agent:breaker-status`). */
  status(): AgentBreakerStatus {
    const trips: BreakerTripEvent[] = []
    for (const state of this.byThread.values()) {
      if (state.trip !== null) trips.push(state.trip)
    }
    return {
      trips,
      signalsDegraded: !(this.deps.isSignalSourceHealthy?.() ?? true)
    }
  }

  // -- Internal --

  private stateFor(threadId: string, agentId: string): ThreadBreakerState {
    const existing = this.byThread.get(threadId)
    if (existing !== undefined) {
      existing.agentId = agentId
      return existing
    }
    const state = freshState(agentId)
    this.byThread.set(threadId, state)
    return state
  }

  private trip(
    state: ThreadBreakerState,
    signal: BreakerSignal,
    reason: BreakerReason,
    detail: string,
    opts?: { readonly noticeOnly?: boolean }
  ): void {
    const action: BreakerAction =
      signal.concurrentTurns || opts?.noticeOnly === true ? 'notice' : 'killed'
    // Notice-latched episodes stay quiet on further ambiguous signals (no
    // event spam) but may ESCALATE once an unambiguous signal arrives.
    if (state.trip !== null && action === 'notice') return
    const event: BreakerTripEvent = {
      threadId: signal.threadId,
      agentId: signal.agentId,
      reason,
      action,
      detail,
      at: new Date(this.deps.now?.() ?? Date.now()).toISOString()
    }
    state.trip = event
    if (action === 'killed') {
      try {
        this.deps.kill(signal.threadId)
      } catch (err) {
        // A failed kill must not silence the trip record — the audit entry
        // and event below are the visibility path either way.
        this.deps.audit.log(this.auditEntry(event, `kill failed: ${String(err)}`))
        this.deps.emit?.(event)
        return
      }
    }
    this.deps.audit.log(this.auditEntry(event))
    this.deps.emit?.(event)
  }

  private auditEntry(event: BreakerTripEvent, error?: string): AuditEntry {
    return {
      ts: event.at,
      tool: 'cli-agent:breaker-tripped',
      args: {
        threadId: event.threadId,
        agentId: event.agentId,
        reason: event.reason,
        action: event.action,
        detail: event.detail
      },
      affectedPaths: [],
      // 'denied' = containment applied (PTY killed); 'error' = anomaly
      // surfaced without an action (ambiguous attribution → notice).
      decision: event.action === 'killed' ? 'denied' : 'error',
      error: error ?? `circuit breaker tripped (${event.reason}): ${event.detail}`
    }
  }
}

function freshState(agentId: string): ThreadBreakerState {
  return {
    agentId,
    consecutiveVelocity: 0,
    forbiddenTurnId: null,
    forbiddenCount: 0,
    trip: null
  }
}

// ── Singleton wiring ─────────────────────────────────────────────────────
// Kill and health are late-bound (the setPtyAliveProbe pattern): the spawner
// (ipc/cli-thread.ts) owns the hard-kill path, and ipc/git.ts owns the
// watcher-health state — direct imports from here would be cycles.

let killCallback: ((threadId: string) => void) | null = null
let signalHealthProbe: (() => boolean) | null = null
let emitCallback: ((event: BreakerTripEvent) => void) | null = null
let singleton: AgentCircuitBreaker | null = null

/** Wired in ipc/cli-thread.ts: spawner.close (kill PTY + drop turn window). */
export function setBreakerKillCallback(callback: (threadId: string) => void): void {
  killCallback = callback
}

/** Wired in ipc/git.ts registerGitIpc: watcher health state === 'watching'. */
export function setBreakerSignalHealthProbe(probe: () => boolean): void {
  signalHealthProbe = probe
}

/** Wired in ipc/cli-thread.ts: typedSend('agent:breaker-tripped') broadcast. */
export function setBreakerEmit(emit: (event: BreakerTripEvent) => void): void {
  emitCallback = emit
}

export function getAgentCircuitBreaker(): AgentCircuitBreaker {
  if (singleton === null) {
    singleton = new AgentCircuitBreaker({
      // Same location as the approvals-queue logger (ipc/git.ts): userData/
      // audit is outside any workspace watch root; AuditLogger appends, so
      // parallel instances on the same dir are safe.
      audit: new AuditLogger(join(app.getPath('userData'), 'audit')),
      kill: (threadId) => killCallback?.(threadId),
      emit: (event) => emitCallback?.(event),
      isSignalSourceHealthy: () => signalHealthProbe?.() ?? true
    })
  }
  return singleton
}
