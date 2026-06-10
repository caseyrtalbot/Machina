import { create } from 'zustand'
import { useVaultStore } from './vault-store'

/** Persisted UI state rehydrated from VaultState on vault load. */
interface UiRehydrateInput {
  readonly backlinkCollapsed: Record<string, boolean>
  readonly dismissedGhosts: readonly string[]
  readonly outlineVisible: boolean
  readonly bookmarkedPaths: readonly string[]
  readonly graphTutorialDismissed: boolean
  readonly fileTreeCollapseState: Record<string, boolean>
}

interface UiStore {
  readonly backlinkCollapsed: Readonly<Record<string, boolean>>
  readonly dismissedGhosts: readonly string[]
  readonly outlineVisible: boolean
  readonly bookmarkedPaths: readonly string[]
  readonly graphTutorialDismissed: boolean
  /** Collapsed directories in the Files dock tree (true = collapsed). */
  readonly fileTreeCollapseState: Readonly<Record<string, boolean>>

  getBacklinkCollapsed: (notePath: string) => boolean
  toggleBacklinkCollapsed: (notePath: string) => void
  toggleOutline: () => void
  dismissGhost: (id: string) => void
  undismissGhost: (id: string) => void
  isGhostDismissed: (id: string) => boolean
  toggleBookmark: (path: string) => void
  isBookmarked: (path: string) => boolean
  dismissGraphTutorial: () => void
  toggleFileTreeCollapsed: (path: string) => void
  rehydrate: (persisted: UiRehydrateInput) => void
}

/**
 * Single owner of persisted UI state. Persistence is wired externally:
 * vault-persist subscribes to this store and schedules a debounced write of
 * the gathered VaultState on every change.
 */
export const useUiStore = create<UiStore>((set, get) => ({
  backlinkCollapsed: {},
  dismissedGhosts: [],
  outlineVisible: false,
  bookmarkedPaths: [],
  graphTutorialDismissed: false,
  fileTreeCollapseState: {},

  getBacklinkCollapsed: (notePath) => get().backlinkCollapsed[notePath] ?? true,

  toggleBacklinkCollapsed: (notePath) => {
    const current = get().backlinkCollapsed[notePath] ?? true
    set({ backlinkCollapsed: { ...get().backlinkCollapsed, [notePath]: !current } })
  },

  toggleOutline: () => set({ outlineVisible: !get().outlineVisible }),

  dismissGhost: (id) => {
    const current = get().dismissedGhosts
    if (current.includes(id)) return
    set({ dismissedGhosts: [...current, id] })
  },

  undismissGhost: (id) => set({ dismissedGhosts: get().dismissedGhosts.filter((g) => g !== id) }),

  isGhostDismissed: (id) => get().dismissedGhosts.includes(id),

  toggleBookmark: (path) => {
    const current = get().bookmarkedPaths
    const next = current.includes(path) ? current.filter((p) => p !== path) : [...current, path]
    set({ bookmarkedPaths: next })
  },

  isBookmarked: (path) => get().bookmarkedPaths.includes(path),

  dismissGraphTutorial: () => {
    if (get().graphTutorialDismissed) return
    set({ graphTutorialDismissed: true })
  },

  toggleFileTreeCollapsed: (path) => {
    const current = get().fileTreeCollapseState
    const next = { ...current }
    if (next[path]) delete next[path]
    else next[path] = true
    set({ fileTreeCollapseState: next })
  },

  rehydrate: (persisted) => {
    set({
      backlinkCollapsed: { ...persisted.backlinkCollapsed },
      dismissedGhosts: [...persisted.dismissedGhosts],
      outlineVisible: persisted.outlineVisible,
      bookmarkedPaths: [...persisted.bookmarkedPaths],
      graphTutorialDismissed: persisted.graphTutorialDismissed,
      fileTreeCollapseState: { ...persisted.fileTreeCollapseState }
    })
  }
}))

/**
 * Rehydrate ui-store from the loaded VaultState in vault-store.
 * Call after vault load completes.
 */
export function rehydrateUiStore(): void {
  const state = useVaultStore.getState().state
  const ui = state?.ui
  useUiStore.getState().rehydrate({
    backlinkCollapsed: ui?.backlinkCollapsed ?? {},
    dismissedGhosts: ui?.dismissedGhosts ?? [],
    outlineVisible: ui?.outlineVisible ?? false,
    bookmarkedPaths: ui?.bookmarkedPaths ?? [],
    graphTutorialDismissed: ui?.graphTutorialDismissed ?? false,
    fileTreeCollapseState: state?.fileTreeCollapseState ?? {}
  })
}
