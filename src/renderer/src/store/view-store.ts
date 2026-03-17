import { create } from 'zustand'

export type ContentView = 'editor' | 'canvas' | 'skills' | 'claude-config'

interface ViewStore {
  readonly contentView: ContentView
  readonly previousView: ContentView | null
  setContentView: (view: ContentView) => void
  toggleClaudeConfig: () => void
}

export const useViewStore = create<ViewStore>((set, get) => ({
  contentView: 'editor',
  previousView: null,

  setContentView: (view) => set({ contentView: view, previousView: get().contentView }),

  toggleClaudeConfig: () => {
    const current = get().contentView
    if (current === 'claude-config') {
      const prev = get().previousView ?? 'editor'
      set({ contentView: prev, previousView: 'claude-config' })
    } else {
      set({ contentView: 'claude-config', previousView: current })
    }
  }
}))
