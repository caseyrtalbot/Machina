import { create } from 'zustand'
import type { CanvasNode, CanvasEdge, CanvasViewport, CanvasFile } from '@shared/canvas-types'
import { getDefaultMetadata } from '@shared/canvas-types'

interface CanvasStore {
  // Document state
  readonly filePath: string | null
  readonly nodes: readonly CanvasNode[]
  readonly edges: readonly CanvasEdge[]
  readonly viewport: CanvasViewport
  readonly isDirty: boolean

  // Selection
  readonly selectedNodeIds: ReadonlySet<string>
  readonly selectedEdgeId: string | null

  // Interaction state
  readonly focusedTerminalId: string | null

  // Document lifecycle
  loadCanvas: (filePath: string, data: CanvasFile) => void
  closeCanvas: () => void
  markSaved: () => void

  // Node mutations
  addNode: (node: CanvasNode) => void
  removeNode: (id: string) => void
  moveNode: (id: string, position: { x: number; y: number }) => void
  resizeNode: (id: string, size: { width: number; height: number }) => void
  updateNodeContent: (id: string, content: string) => void
  updateNodeMetadata: (id: string, partial: Partial<Record<string, unknown>>) => void
  updateNodeType: (id: string, type: CanvasNode['type']) => void

  // Edge mutations
  addEdge: (edge: CanvasEdge) => void
  removeEdge: (id: string) => void

  // Selection
  setSelection: (ids: Set<string>) => void
  toggleSelection: (id: string) => void
  clearSelection: () => void
  setSelectedEdge: (id: string | null) => void

  // Viewport
  setViewport: (viewport: CanvasViewport) => void

  // Terminal focus
  setFocusedTerminal: (id: string | null) => void

  // Snapshot for persistence
  toCanvasFile: () => CanvasFile
}

const INITIAL_VIEWPORT: CanvasViewport = { x: 0, y: 0, zoom: 1 }

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  filePath: null,
  nodes: [],
  edges: [],
  viewport: INITIAL_VIEWPORT,
  isDirty: false,
  selectedNodeIds: new Set(),
  selectedEdgeId: null,
  focusedTerminalId: null,

  loadCanvas: (filePath, data) =>
    set({
      filePath,
      nodes: data.nodes,
      edges: data.edges,
      viewport: data.viewport,
      isDirty: false,
      selectedNodeIds: new Set(),
      selectedEdgeId: null,
      focusedTerminalId: null
    }),

  closeCanvas: () =>
    set({
      filePath: null,
      nodes: [],
      edges: [],
      viewport: INITIAL_VIEWPORT,
      isDirty: false,
      selectedNodeIds: new Set(),
      selectedEdgeId: null,
      focusedTerminalId: null
    }),

  markSaved: () => set({ isDirty: false }),

  addNode: (node) => set((s) => ({ nodes: [...s.nodes, node], isDirty: true })),

  removeNode: (id) =>
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== id),
      edges: s.edges.filter((e) => e.fromNode !== id && e.toNode !== id),
      selectedNodeIds: (() => {
        const next = new Set(s.selectedNodeIds)
        next.delete(id)
        return next
      })(),
      isDirty: true
    })),

  moveNode: (id, position) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, position } : n)),
      isDirty: true
    })),

  resizeNode: (id, size) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, size } : n)),
      isDirty: true
    })),

  updateNodeContent: (id, content) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, content } : n)),
      isDirty: true
    })),

  updateNodeMetadata: (id, partial) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id ? { ...n, metadata: { ...n.metadata, ...partial } } : n
      ),
      isDirty: true
    })),

  updateNodeType: (id, type) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id ? { ...n, type, content: '', metadata: getDefaultMetadata(type) } : n
      ),
      isDirty: true
    })),

  addEdge: (edge) => set((s) => ({ edges: [...s.edges, edge], isDirty: true })),

  removeEdge: (id) =>
    set((s) => ({
      edges: s.edges.filter((e) => e.id !== id),
      selectedEdgeId: s.selectedEdgeId === id ? null : s.selectedEdgeId,
      isDirty: true
    })),

  setSelection: (ids) => set({ selectedNodeIds: ids }),
  toggleSelection: (id) =>
    set((s) => {
      const next = new Set(s.selectedNodeIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { selectedNodeIds: next }
    }),
  clearSelection: () => set({ selectedNodeIds: new Set(), selectedEdgeId: null }),
  setSelectedEdge: (id) => set({ selectedEdgeId: id, selectedNodeIds: new Set() }),

  setViewport: (viewport) => set({ viewport }),

  setFocusedTerminal: (id) => set({ focusedTerminalId: id }),

  toCanvasFile: () => {
    const { nodes, edges, viewport } = get()
    return { nodes: [...nodes], edges: [...edges], viewport: { ...viewport } }
  }
}))
