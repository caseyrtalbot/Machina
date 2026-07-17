/**
 * Agent circuit-breaker shared types (workstation contracts §5, Phase 2
 * step 6). The breaker escalates the gate's ADVISORY signals (velocity,
 * repeated forbidden auto-rejects, headMoved, maxTurns breach) to a hard PTY
 * kill within the §4 containment framing: breakers contain accidents faster;
 * they never claim prevention — the writes that tripped it are already on
 * disk and stay owned by the approvals queue.
 */

/**
 * What escalated: the breaker's trip inputs (contracts §5 v1.2.6;
 * 'max-spend' added in Phase 3 step 5 — notice-class ONLY, structurally
 * kill-incapable until step 6 calibrates the loop-level disarm).
 */
export type BreakerReason =
  | 'velocity'
  | 'forbidden-writes'
  | 'head-moved'
  | 'max-turns'
  | 'max-spend'

/**
 * What the trip did. 'killed' = the thread's PTY was closed (the containment
 * action, applied exactly once per trip). 'notice' = the triggering signal
 * carried the `concurrentTurns` ambiguity flag — killing could hit the wrong
 * agent, so the breaker surfaces a tray notice and leaves the kill manual.
 */
export type BreakerAction = 'killed' | 'notice'

export interface BreakerTripEvent {
  readonly threadId: string
  readonly agentId: string
  readonly reason: BreakerReason
  readonly action: BreakerAction
  /** Human-readable specifics (counts, budget, turn id). */
  readonly detail: string
  /** ISO 8601 trip time. */
  readonly at: string
}

export interface AgentBreakerStatus {
  /** Currently-tripped threads (cleared when the thread's next turn opens). */
  readonly trips: readonly BreakerTripEvent[]
  /**
   * True when the agent-write watcher is not 'watching': the breaker's
   * velocity / forbidden / headMoved signal sources have no coverage right
   * now, and silence must not be read as health (honest-copy principle).
   * maxTurns counting is registry-side and unaffected.
   */
  readonly signalsDegraded: boolean
}
