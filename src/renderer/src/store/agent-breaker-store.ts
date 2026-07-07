/**
 * Agent circuit-breaker mirror (workstation Phase 2 step 6, contracts §5/§6
 * v1.2.6). Renderer view of the main-side breaker: currently-tripped threads
 * (one latest trip per thread — main clears a thread's trip when its next
 * turn opens) plus the signal-source honesty flag. Push via the
 * agent:breaker-tripped event; pull via agent:breaker-status for late
 * subscribers (boot, popover open).
 */
import { create } from 'zustand'
import type { BreakerTripEvent } from '@shared/agent-breaker-types'
import { logError } from '../utils/error-logger'

interface AgentBreakerState {
  /** Latest trip per thread — insertion-ordered for the tray notice rows. */
  readonly trips: readonly BreakerTripEvent[]
  /** Watcher-sourced breaker signals currently have no coverage (honesty). */
  readonly signalsDegraded: boolean
  refresh: () => Promise<void>
  applyTrip: (event: BreakerTripEvent) => void
}

export const useAgentBreakerStore = create<AgentBreakerState>((set, get) => ({
  trips: [],
  signalsDegraded: false,

  refresh: async () => {
    try {
      const status = await window.api.breaker.status()
      set({ trips: status.trips, signalsDegraded: status.signalsDegraded })
    } catch (err) {
      // Non-critical mirror: keep the last snapshot.
      logError('breaker-status', err)
    }
  },

  applyTrip: (event) => {
    // One row per thread — a re-trip (notice → killed escalation, or a fresh
    // episode after re-engagement) replaces the thread's previous row.
    const rest = get().trips.filter((t) => t.threadId !== event.threadId)
    set({ trips: [...rest, event] })
  }
}))

/** Trip for one thread, or null — the kill-switch chip's selector. */
export function tripForThread(
  trips: readonly BreakerTripEvent[],
  threadId: string
): BreakerTripEvent | null {
  return trips.find((t) => t.threadId === threadId) ?? null
}

// Module-level IPC subscription (same pattern as approvals-store). Guarded so
// plain unit tests can import this module without a preload bridge.
if (typeof window !== 'undefined' && window.api?.on?.agentBreakerTripped) {
  window.api.on.agentBreakerTripped((event) => {
    useAgentBreakerStore.getState().applyTrip(event)
  })
}
