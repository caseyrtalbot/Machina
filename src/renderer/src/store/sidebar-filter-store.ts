import { create } from 'zustand'

interface SidebarFilterStore {
  readonly selectedTags: readonly string[]
  readonly tagOperator: 'and' | 'or'
  readonly expandedTagPaths: ReadonlySet<string>

  toggleTag: (tagPath: string) => void
  clearTags: () => void
  setTagOperator: (op: 'and' | 'or') => void
  toggleTagExpanded: (tagPath: string) => void
}

export const useSidebarFilterStore = create<SidebarFilterStore>((set, get) => ({
  selectedTags: [],
  tagOperator: 'or',
  expandedTagPaths: new Set<string>(),

  toggleTag: (tagPath) => {
    const current = get().selectedTags
    const next = current.includes(tagPath)
      ? current.filter((t) => t !== tagPath)
      : [...current, tagPath]
    set({ selectedTags: next })
  },

  clearTags: () => set({ selectedTags: [] }),

  setTagOperator: (op) => set({ tagOperator: op }),

  toggleTagExpanded: (tagPath) => {
    const current = get().expandedTagPaths
    const next = new Set(current)
    if (next.has(tagPath)) {
      next.delete(tagPath)
    } else {
      next.add(tagPath)
    }
    set({ expandedTagPaths: next })
  }
}))
