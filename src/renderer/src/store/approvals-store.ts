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
import type { GitOpResult, PendingChange, WatcherHealth } from '@shared/git-types'

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

/**
 * Warning-surface visibility (contracts §4 v1.2.1): unhealthy = any state
 * outside watching/stopped. 'stopped' is deliberate disarm (workspace
 * switch / shutdown), not a failure. null = health unknown (no event yet).
 */
export function isWatcherUnhealthy(health: WatcherHealth | null): boolean {
  return health !== null && health.state !== 'watching' && health.state !== 'stopped'
}

/**
 * Display-side mirror of resolve()'s root check (contracts §4 v1.3.0): a
 * foreign-root item cannot be resolved from this workspace — main refuses
 * with 'workspace-changed'. Mirrors the main-side predicate exactly
 * (approval-queue.ts resolve()): an item with no recorded capturedRoot
 * (pre-v1.3.0 shape) is treated as same-root — main remains the enforcement
 * authority either way. Display data only, never the enforcement input.
 */
export function isForeignRoot(item: PendingChange, activeRoot: string | null): boolean {
  return item.capturedRoot !== undefined && item.capturedRoot !== activeRoot
}

interface ApprovalsStore {
  readonly items: readonly PendingChange[]
  readonly pending: number
  /**
   * Active workspace root (main-side canonical value via workspace:current),
   * refreshed with the item list so root labels and the foreign-root switch
   * affordance always compare against the same snapshot. null = no workspace
   * open OR not yet known — both degrade to the safe side (foreign, so the
   * tray offers switch instead of a resolve main would refuse anyway).
   */
  readonly activeRoot: string | null
  readonly notice: string | null
  /** True while a resolve() round-trip is in flight (disables buttons). */
  readonly resolving: string | null
  /** Agent-write-watcher health mirror; null until the first event/status. */
  readonly watcherHealth: WatcherHealth | null
  /** True while a watcher-retry round-trip is in flight (disables Retry). */
  readonly retrying: boolean
  refresh: () => Promise<void>
  resolve: (id: string, approve: boolean, message?: string) => Promise<GitOpResult>
  setPending: (pending: number) => void
  clearNotice: () => void
  setWatcherHealth: (health: WatcherHealth) => void
  refreshWatcherHealth: () => Promise<void>
  retryWatcher: () => Promise<void>
}

export const useApprovalsStore = create<ApprovalsStore>((set, get) => ({
  items: [],
  pending: 0,
  activeRoot: null,
  notice: null,
  resolving: null,
  watcherHealth: null,
  retrying: false,

  refresh: async () => {
    // Fetched together so items and activeRoot land in one atomic set() —
    // labels never render against a root snapshot from a different fetch.
    // Root read degrades to null (= foreign display, main still enforces).
    const [items, workspace] = await Promise.all([
      window.api.approvals.list(),
      window.api.workspace.current().catch(() => null)
    ])
    set({ items, pending: items.length, activeRoot: workspace?.root ?? null })
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

  clearNotice: () => set({ notice: null }),

  setWatcherHealth: (health) => set({ watcherHealth: health }),

  refreshWatcherHealth: async () => {
    set({ watcherHealth: await window.api.approvals.watcherStatus() })
  },

  retryWatcher: async () => {
    set({ retrying: true })
    try {
      await window.api.approvals.watcherRetry()
      // The event stream is the source of truth; this covers a missed event.
      await get().refreshWatcherHealth()
    } finally {
      set({ retrying: false })
    }
  }
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

// Watcher health transitions (contracts §4 v1.2.1): same module-level pattern.
if (typeof window !== 'undefined' && window.api?.on?.watcherHealth) {
  window.api.on.watcherHealth((health) => {
    useApprovalsStore.getState().setWatcherHealth(health)
  })
}
