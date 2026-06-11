import { create } from 'zustand'

/**
 * Enrichment run state (3.9), hoisted out of EnrichmentPill: starting a run
 * switches the active thread, which remounts the GraphPanel (and the pill) in
 * the new thread's dock. Component-local state died in that remount, so the
 * pill could never show progress/completion and a remounted idle pill allowed
 * a second concurrent run. Any pill instance reads this shared store instead.
 */
interface EnrichmentRunState {
  /** Thread carrying the active or most recent enrichment run. */
  threadId: string | null
  batchSize: number
  /** True between the click and the first turn being dispatched. */
  starting: boolean
  /** True when the run's turn hit the agent's per-turn tool budget. */
  stoppedAtLimit: boolean

  beginStart: () => void
  bindThread: (threadId: string, batchSize: number) => void
  endStart: () => void
  markStoppedAtLimit: (threadId: string) => void
}

export const useEnrichmentRunStore = create<EnrichmentRunState>((set, get) => ({
  threadId: null,
  batchSize: 0,
  starting: false,
  stoppedAtLimit: false,

  beginStart: () => set({ starting: true, stoppedAtLimit: false }),

  bindThread: (threadId, batchSize) => set({ threadId, batchSize }),

  endStart: () => set({ starting: false }),

  markStoppedAtLimit: (threadId) => {
    if (get().threadId === threadId) set({ stoppedAtLimit: true })
  }
}))

// Module-level IPC subscription (same pattern as block-store): when the
// enrichment run's turn exhausts the agent's tool budget, flag it so the pill
// reports "stopped mid-batch" instead of "finished". Guarded so plain unit
// tests can import this module without a preload bridge.
if (typeof window !== 'undefined' && window.api?.on?.agentNativeEvent) {
  window.api.on.agentNativeEvent((evt) => {
    if (evt.kind === 'turn_limit') {
      useEnrichmentRunStore.getState().markStoppedAtLimit(evt.threadId)
    }
  })
}
