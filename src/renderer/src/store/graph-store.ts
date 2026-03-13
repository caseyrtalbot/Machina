import { create } from 'zustand'
import type { ArtifactType, Signal } from '@shared/types'

type ContentView = 'editor' | 'graph' | 'skills'

interface GraphStore {
  contentView: ContentView
  selectedNodeId: string | null
  hoveredNodeId: string | null
  typeFilters: Set<ArtifactType>
  signalFilter: Signal | null

  setContentView: (view: ContentView) => void
  setSelectedNode: (id: string | null) => void
  setHoveredNode: (id: string | null) => void
  toggleTypeFilter: (type: ArtifactType) => void
  setSignalFilter: (signal: Signal | null) => void
}

export const useGraphStore = create<GraphStore>((set, get) => ({
  contentView: 'editor',
  selectedNodeId: null,
  hoveredNodeId: null,
  typeFilters: new Set(['gene', 'constraint', 'research', 'output', 'note', 'index']),
  signalFilter: null,

  setContentView: (view) => set({ contentView: view }),
  setSelectedNode: (id) => set({ selectedNodeId: id }),
  setHoveredNode: (id) => set({ hoveredNodeId: id }),
  toggleTypeFilter: (type) => {
    const current = new Set(get().typeFilters)
    if (current.has(type)) current.delete(type)
    else current.add(type)
    set({ typeFilters: current })
  },
  setSignalFilter: (signal) => set({ signalFilter: signal })
}))
