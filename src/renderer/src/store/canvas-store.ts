import { create } from 'zustand'
import type { CanvasNode, CanvasEdge, CanvasViewport, CanvasFile } from '@shared/canvas-types'
import { getDefaultMetadata } from '@shared/canvas-types'
import { spatialSort, nextCard, prevCard } from '../panels/canvas/canvas-spatial-nav'
import { computeTileLayout, type TilePattern } from '../panels/canvas/canvas-tiling'

interface CanvasStore {
  // Document state
  readonly filePath: string | null
  readonly nodes: readonly CanvasNode[]
  readonly edges: readonly CanvasEdge[]
  readonly viewport: CanvasViewport
  readonly isDirty: boolean

  // Focus Frames: named viewport positions (tmux-style CMD+1-5)
  readonly focusFrames: Readonly<Record<string, CanvasViewport>>

  // Selection
  readonly selectedNodeIds: ReadonlySet<string>
  readonly selectedEdgeId: string | null

  // Spatial navigation: keyboard cursor (independent of selection)
  readonly focusedCardId: string | null

  // Interaction state
  readonly hoveredNodeId: string | null
  readonly focusedTerminalId: string | null
  readonly cardContextMenu: {
    readonly x: number
    readonly y: number
    readonly nodeId: string
  } | null

  // Bridge: registered by CanvasView for accurate viewport centering
  readonly centerOnNode: ((nodeId: string) => void) | null

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

  // Batch mutations
  addNodesAndEdges: (nodes: readonly CanvasNode[], edges: readonly CanvasEdge[]) => void

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

  // Focus Frames
  saveFocusFrame: (slot: string) => void
  jumpToFocusFrame: (slot: string) => void

  // Hover
  setHoveredNode: (id: string | null) => void

  // Terminal focus
  setFocusedTerminal: (id: string | null) => void

  // Card context menu
  setCardContextMenu: (menu: { x: number; y: number; nodeId: string } | null) => void

  // Spatial navigation
  setFocusedCard: (id: string | null) => void
  focusNextCard: () => void
  focusPrevCard: () => void

  // Tiling
  applyTileLayout: (pattern: TilePattern, viewportCenter: { x: number; y: number }) => void

  // Bridge registration
  setCenterOnNode: (handler: ((nodeId: string) => void) | null) => void

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
  focusFrames: {},
  selectedNodeIds: new Set(),
  selectedEdgeId: null,
  focusedCardId: null,
  hoveredNodeId: null,
  focusedTerminalId: null,
  cardContextMenu: null,
  centerOnNode: null,

  loadCanvas: (filePath, data) =>
    set({
      filePath,
      nodes: data.nodes,
      edges: data.edges,
      viewport: data.viewport,
      focusFrames: data.focusFrames ?? {},
      isDirty: false,
      selectedNodeIds: new Set(),
      selectedEdgeId: null,
      focusedCardId: null,
      hoveredNodeId: null,
      focusedTerminalId: null,
      cardContextMenu: null
    }),

  closeCanvas: () =>
    set({
      filePath: null,
      nodes: [],
      edges: [],
      viewport: INITIAL_VIEWPORT,
      focusFrames: {},
      isDirty: false,
      selectedNodeIds: new Set(),
      selectedEdgeId: null,
      focusedCardId: null,
      hoveredNodeId: null,
      cardContextMenu: null,
      focusedTerminalId: null
    }),

  markSaved: () => set({ isDirty: false }),

  addNode: (node) => set((s) => ({ nodes: [...s.nodes, node], isDirty: true })),

  removeNode: (id) =>
    set((s) => {
      const selectedNodeIds = new Set(s.selectedNodeIds)
      selectedNodeIds.delete(id)
      return {
        nodes: s.nodes.filter((n) => n.id !== id),
        edges: s.edges.filter((e) => e.fromNode !== id && e.toNode !== id),
        selectedNodeIds,
        isDirty: true
      }
    }),

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

  updateNodeMetadata: (id, partial) => {
    // Only isActive is ephemeral (runtime-only, never persisted).
    // initialCwd and initialCommand persist to disk for session restoration.
    const ephemeralOnly = Object.keys(partial).every((k) => k === 'isActive')
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id ? { ...n, metadata: { ...n.metadata, ...partial } } : n
      ),
      isDirty: ephemeralOnly ? s.isDirty : true
    }))
  },

  updateNodeType: (id, type) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id ? { ...n, type, content: '', metadata: getDefaultMetadata(type) } : n
      ),
      isDirty: true
    })),

  addNodesAndEdges: (nodes, edges) =>
    set((s) => ({
      nodes: [...s.nodes, ...nodes],
      edges: [...s.edges, ...edges],
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

  saveFocusFrame: (slot) => {
    const { viewport, focusFrames } = get()
    set({
      focusFrames: { ...focusFrames, [slot]: { ...viewport } },
      isDirty: true
    })
  },

  jumpToFocusFrame: (slot) => {
    const frame = get().focusFrames[slot]
    if (frame) set({ viewport: { ...frame } })
    // intentionally does NOT set isDirty
  },

  setHoveredNode: (id) => set({ hoveredNodeId: id }),

  setFocusedTerminal: (id) => set({ focusedTerminalId: id }),

  setCardContextMenu: (menu) => set({ cardContextMenu: menu }),

  setFocusedCard: (id) => set({ focusedCardId: id }),

  focusNextCard: () => {
    const { nodes, focusedCardId, centerOnNode } = get()
    const sorted = spatialSort(nodes)
    const next = nextCard(sorted, focusedCardId)
    if (next) {
      set({ focusedCardId: next })
      centerOnNode?.(next)
    }
  },

  focusPrevCard: () => {
    const { nodes, focusedCardId, centerOnNode } = get()
    const sorted = spatialSort(nodes)
    const prev = prevCard(sorted, focusedCardId)
    if (prev) {
      set({ focusedCardId: prev })
      centerOnNode?.(prev)
    }
  },

  applyTileLayout: (pattern, viewportCenter) => {
    const { nodes, selectedNodeIds } = get()
    // Tile selected cards if any are selected, otherwise tile all
    const targetNodes =
      selectedNodeIds.size > 0 ? nodes.filter((n) => selectedNodeIds.has(n.id)) : nodes
    if (targetNodes.length === 0) return
    const cards = targetNodes.map((n) => ({ id: n.id, size: n.size }))
    const positions = computeTileLayout(pattern, viewportCenter, cards)
    set((s) => ({
      nodes: s.nodes.map((n) => {
        const pos = positions.get(n.id)
        return pos ? { ...n, position: pos } : n
      }),
      isDirty: true
    }))
  },

  setCenterOnNode: (handler) => set({ centerOnNode: handler }),

  toCanvasFile: () => {
    const { nodes, edges, viewport, focusFrames } = get()
    // Only strip isActive (runtime-only). initialCwd and initialCommand
    // persist to disk so terminal cards restore with correct cwd and command.
    const EPHEMERAL_KEYS = new Set(['isActive'])
    const cleanNodes = nodes.map((n) => ({
      ...n,
      metadata: n.metadata
        ? Object.fromEntries(Object.entries(n.metadata).filter(([k]) => !EPHEMERAL_KEYS.has(k)))
        : {}
    }))
    return {
      nodes: cleanNodes,
      edges: [...edges],
      viewport: { ...viewport },
      focusFrames: { ...focusFrames }
    }
  }
}))
