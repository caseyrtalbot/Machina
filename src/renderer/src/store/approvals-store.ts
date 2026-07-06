/**
 * Approvals store (workstation step 3, contracts §4/§6).
 *
 * Renderer mirror of the main-process ApprovalQueue: the pending list, the
 * badge count, and resolve() with the stale-diff contract surfaced honestly —
 * a 'stale-diff' result means the disk changed after the reviewed snapshot;
 * the item was refreshed main-side and MUST be re-reviewed, so the store
 * refreshes the list and posts a notice instead of retrying.
 */
import { create } from 'zustand'
import type { GitOpResult, PendingChange } from '@shared/git-types'

/** User-facing notice per failed-resolve reason (structured errors only). */
export function noticeForFailure(reason: string): string {
  switch (reason) {
    case 'stale-diff':
      return 'The files changed after this diff was captured. Review the updated diff and decide again.'
    case 'workspace-changed':
      return 'This change was captured in a different workspace. Reopen that workspace to resolve it.'
    case 'not-a-git-repo':
      return 'This workspace is not a git repository — there is nothing to revert from. The item stays for visibility.'
    case 'no-workspace':
      return 'No workspace is open.'
    default:
      return `Could not resolve: ${reason}`
  }
}

interface ApprovalsStore {
  readonly items: readonly PendingChange[]
  readonly pending: number
  readonly notice: string | null
  /** True while a resolve() round-trip is in flight (disables buttons). */
  readonly resolving: string | null
  refresh: () => Promise<void>
  resolve: (id: string, approve: boolean, message?: string) => Promise<GitOpResult>
  setPending: (pending: number) => void
  clearNotice: () => void
}

export const useApprovalsStore = create<ApprovalsStore>((set, get) => ({
  items: [],
  pending: 0,
  notice: null,
  resolving: null,

  refresh: async () => {
    const items = await window.api.approvals.list()
    set({ items, pending: items.length })
  },

  resolve: async (id, approve, message) => {
    set({ resolving: id, notice: null })
    try {
      const result = await window.api.approvals.resolve(id, approve, message)
      if (!result.ok) {
        set({ notice: noticeForFailure(result.reason) })
      }
      await get().refresh()
      return result
    } finally {
      set({ resolving: null })
    }
  },

  setPending: (pending) => set({ pending }),

  clearNotice: () => set({ notice: null })
}))

// Module-level IPC subscription (same pattern as block-store): every queue
// mutation main-side broadcasts approvals:changed with the pending count.
// Guarded so plain unit tests can import this module without a preload bridge.
if (typeof window !== 'undefined' && window.api?.on?.approvalsChanged) {
  window.api.on.approvalsChanged(({ pending }) => {
    useApprovalsStore.getState().setPending(pending)
    void useApprovalsStore.getState().refresh()
  })
}
