import { create } from 'zustand'
import { useTabStore, TAB_DEFINITIONS } from './tab-store'
import type { TabType } from './tab-store'

type ContentView = TabType

interface ViewStore {
  readonly contentView: ContentView
  setContentView: (view: ContentView) => void
}

/**
 * Backward-compatible bridge: reads active view from tab-store.
 * Existing code that calls setContentView or reads contentView
 * continues to work without modification.
 */
export const useViewStore = create<ViewStore>(() => ({
  contentView: (useTabStore.getState().tabs.find((t) => t.id === useTabStore.getState().activeTabId)
    ?.type ?? 'editor') as ContentView,

  setContentView: (view: ContentView) => {
    const def = TAB_DEFINITIONS[view]
    useTabStore.getState().openTab({
      id: view,
      type: view,
      label: def.label,
      closeable: view !== 'editor'
    })
  }
}))

// Sync contentView whenever tab-store changes
useTabStore.subscribe((state) => {
  const activeTab = state.tabs.find((t) => t.id === state.activeTabId)
  const viewType = (activeTab?.type ?? 'editor') as ContentView
  if (useViewStore.getState().contentView !== viewType) {
    useViewStore.setState({ contentView: viewType })
  }
})
