import { create } from 'zustand'
import type { HarnessSummary } from '@shared/harness-types'
import { logError } from '../utils/error-logger'

/**
 * Harness palette state (workstation step 6): the synchronous snapshot the
 * command palette reads when building items. `refresh()` is fired on palette
 * open; the palette subscribes to `summaries` so a completed refresh updates
 * the open list.
 */
interface HarnessState {
  summaries: readonly HarnessSummary[]
  refresh: () => Promise<void>
}

export const useHarnessStore = create<HarnessState>((set) => ({
  summaries: [],

  refresh: async () => {
    try {
      const summaries = await window.api.harness.list()
      set({ summaries })
    } catch (err) {
      // Non-critical: the palette just keeps its last snapshot.
      logError('harness-list', err)
    }
  }
}))
