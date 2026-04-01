import { create } from 'zustand'
import type { CanvasNode, CanvasEdge, CanvasViewport, CanvasFile } from '@shared/canvas-types'
import { getDefaultMetadata } from '@shared/canvas-types'
import type { OntologySnapshot, OntologyLayoutResult, GroupId } from '@shared/engine/ontology-types'
import { spatialSort, nextCard, prevCard } from '../panels/canvas/canvas-spatial-nav'
import {
  computeTileLayout,
  computeSemanticLayout,
  type TilePattern,
  type ClusterLabel
} from '../panels/canvas/canvas-tiling'

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

  // Focus lock: double-click a card to lock viewport and enable card scrolling
  readonly lockedCardId: string | null

  // Interaction state
  readonly hoveredNodeId: string | null
  readonly focusedTerminalId: string | null
  readonly cardContextMenu: {
    readonly x: number
    readonly y: number
    readonly nodeId: string
  } | null

  // Split editor: docked code panel on the right side of the canvas
  readonly splitFilePath: string | null

  // Cluster labels from semantic organize
  readonly clusterLabels: readonly ClusterLabel[]

  // Ontology: graphical grouping overlay
  readonly ontologySnapshot: OntologySnapshot | null
  readonly ontologyLayout: OntologyLayoutResult | null
  readonly ontologyIsStale: boolean

  // Bridge: registered by CanvasView for accurate viewport centering
  readonly centerOnNode: ((nodeId: string) => void) | null

  // Folder-map: pending folder path to map onto canvas (set by sidebar/command palette)
  readonly pendingFolderMap: string | null
  setPendingFolderMap: (path: string | null) => void

  // Document lifecycle
  loadCanvas: (filePath: string, data: CanvasFile) => void
  closeCanvas: () => void
  markSaved: () => void

  // Node mutations
  addNode: (node: CanvasNode) => void
  removeNode: (id: string) => void
  moveNode: (id: string, position: { x: number; y: number }) => void
  moveNodes: (updates: ReadonlyMap<string, { x: number; y: number }>) => void
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

  // Focus lock
  lockCard: (id: string) => void
  unlockCard: () => void

  // Split editor
  openSplit: (filePath: string) => void
  closeSplit: () => void

  // Tiling
  applyTileLayout: (pattern: TilePattern, viewportCenter: { x: number; y: number }) => void

  // Semantic organize
  applySemanticLayout: (
    viewportCenter: { x: number; y: number },
    fileToId: ReadonlyMap<string, string>,
    artifacts: ReadonlyMap<string, { id: string; tags: readonly string[] }>,
    graphEdges: readonly { source: string; target: string }[]
  ) => void

  // Bridge registration
  setCenterOnNode: (handler: ((nodeId: string) => void) | null) => void

  // Ontology actions
  applyOntology: (snapshot: OntologySnapshot, layout: OntologyLayoutResult) => void
  clearOntology: () => void
  moveCardToSection: (cardId: string, targetGroupId: GroupId) => void
  removeSection: (groupId: GroupId) => void
  updateSection: (groupId: GroupId, updates: { label?: string; colorToken?: string }) => void

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
  lockedCardId: null,
  hoveredNodeId: null,
  focusedTerminalId: null,
  cardContextMenu: null,
  splitFilePath: null,
  clusterLabels: [],
  ontologySnapshot: null,
  ontologyLayout: null,
  ontologyIsStale: false,
  centerOnNode: null,
  pendingFolderMap: null,
  setPendingFolderMap: (path) => set({ pendingFolderMap: path }),

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
      lockedCardId: null,
      hoveredNodeId: null,
      focusedTerminalId: null,
      cardContextMenu: null,
      ontologySnapshot: data.ontologySnapshot ?? null,
      ontologyLayout: data.ontologyLayout ?? null,
      ontologyIsStale: false
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
      lockedCardId: null,
      hoveredNodeId: null,
      cardContextMenu: null,
      focusedTerminalId: null,
      ontologySnapshot: null,
      ontologyLayout: null,
      ontologyIsStale: false
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
      clusterLabels: [],
      isDirty: true
    })),

  moveNodes: (updates) =>
    set((s) => ({
      nodes: s.nodes.map((n) => {
        const pos = updates.get(n.id)
        return pos ? { ...n, position: pos } : n
      }),
      clusterLabels: [],
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

  lockCard: (id) => {
    set({ lockedCardId: id, focusedCardId: id, selectedNodeIds: new Set([id]) })
  },

  unlockCard: () => set({ lockedCardId: null }),

  openSplit: (filePath) => set({ splitFilePath: filePath }),
  closeSplit: () => set({ splitFilePath: null }),

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

  applySemanticLayout: (viewportCenter, fileToId, artifacts, graphEdges) => {
    const { nodes, selectedNodeIds } = get()
    const targetNodes =
      selectedNodeIds.size > 0 ? nodes.filter((n) => selectedNodeIds.has(n.id)) : nodes
    if (targetNodes.length === 0) return
    const cards = targetNodes.map((n) => ({
      id: n.id,
      size: n.size,
      filePath: (n.metadata?.filePath as string | undefined) ?? n.content
    }))
    const result = computeSemanticLayout(viewportCenter, cards, fileToId, artifacts, graphEdges)
    set((s) => ({
      nodes: s.nodes.map((n) => {
        const pos = result.positions.get(n.id)
        return pos ? { ...n, position: pos } : n
      }),
      clusterLabels: result.labels,
      isDirty: true
    }))
  },

  setCenterOnNode: (handler) => set({ centerOnNode: handler }),

  applyOntology: (snapshot, layout) =>
    set({ ontologySnapshot: snapshot, ontologyLayout: layout, ontologyIsStale: false }),

  clearOntology: () =>
    set({ ontologySnapshot: null, ontologyLayout: null, ontologyIsStale: false }),

  moveCardToSection: (cardId, targetGroupId) => {
    const { ontologySnapshot } = get()
    if (!ontologySnapshot) return

    // Find the source group containing this card
    const sourceGroupId = Object.keys(ontologySnapshot.groupsById).find((gid) =>
      ontologySnapshot.groupsById[gid].cardIds.includes(cardId)
    )
    if (!sourceGroupId || sourceGroupId === targetGroupId) return

    const sourceGroup = ontologySnapshot.groupsById[sourceGroupId]
    const targetGroup = ontologySnapshot.groupsById[targetGroupId]
    if (!targetGroup) return

    const updatedSourceGroup = {
      ...sourceGroup,
      cardIds: sourceGroup.cardIds.filter((id) => id !== cardId)
    }
    const updatedTargetGroup = {
      ...targetGroup,
      cardIds: [...targetGroup.cardIds, cardId]
    }

    let newGroupsById = {
      ...ontologySnapshot.groupsById,
      [sourceGroupId]: updatedSourceGroup,
      [targetGroupId]: updatedTargetGroup
    }

    let newRootGroupIds = [...ontologySnapshot.rootGroupIds]

    // Remove empty source group (no cards and no children)
    if (updatedSourceGroup.cardIds.length === 0) {
      const hasChildren = Object.values(newGroupsById).some(
        (g) => g.id !== updatedSourceGroup.id && g.parentGroupId === updatedSourceGroup.id
      )
      if (!hasChildren) {
        const { [sourceGroupId]: _removed, ...rest } = newGroupsById
        newGroupsById = rest
        newRootGroupIds = newRootGroupIds.filter((id) => id !== sourceGroupId)
      }
    }

    set({
      ontologySnapshot: {
        ...ontologySnapshot,
        groupsById: newGroupsById,
        rootGroupIds: newRootGroupIds as GroupId[]
      },
      ontologyIsStale: true
    })
  },

  removeSection: (groupId) => {
    const { ontologySnapshot } = get()
    if (!ontologySnapshot) return

    // Collect all group ids to remove (the target + all descendants)
    const idsToRemove = new Set<string>()
    const collectDescendants = (id: string): void => {
      idsToRemove.add(id)
      for (const g of Object.values(ontologySnapshot.groupsById)) {
        if (g.parentGroupId === id) {
          collectDescendants(g.id)
        }
      }
    }
    collectDescendants(groupId)

    // Gather all cards from removed groups
    const movedCards: string[] = []
    for (const id of idsToRemove) {
      const group = ontologySnapshot.groupsById[id]
      if (group) {
        movedCards.push(...group.cardIds)
      }
    }

    // Build new groupsById without removed groups
    const newGroupsById: Record<string, (typeof ontologySnapshot.groupsById)[string]> = {}
    for (const [id, group] of Object.entries(ontologySnapshot.groupsById)) {
      if (!idsToRemove.has(id)) {
        newGroupsById[id] = group
      }
    }

    const newRootGroupIds = ontologySnapshot.rootGroupIds.filter((id) => !idsToRemove.has(id))

    set({
      ontologySnapshot: {
        ...ontologySnapshot,
        groupsById: newGroupsById,
        rootGroupIds: newRootGroupIds,
        ungroupedNoteIds: [...ontologySnapshot.ungroupedNoteIds, ...movedCards],
        interGroupEdges: ontologySnapshot.interGroupEdges.filter(
          (e) => !idsToRemove.has(e.fromGroupId) && !idsToRemove.has(e.toGroupId)
        )
      },
      ontologyIsStale: true
    })
  },

  updateSection: (groupId, updates) => {
    const { ontologySnapshot } = get()
    if (!ontologySnapshot) return

    const group = ontologySnapshot.groupsById[groupId]
    if (!group) return

    const newGroupsById = { ...ontologySnapshot.groupsById }

    // Apply updates to the target group
    newGroupsById[groupId] = { ...group, ...updates }

    // Cascade colorToken to child groups
    if (updates.colorToken) {
      const cascadeColor = (parentId: string, color: string): void => {
        for (const [id, g] of Object.entries(newGroupsById)) {
          if (g.parentGroupId === parentId) {
            newGroupsById[id] = { ...g, colorToken: color }
            cascadeColor(id, color)
          }
        }
      }
      cascadeColor(groupId, updates.colorToken)
    }

    set({
      ontologySnapshot: { ...ontologySnapshot, groupsById: newGroupsById },
      ontologyIsStale: true
    })
  },

  toCanvasFile: () => {
    const { nodes, edges, viewport, focusFrames, ontologySnapshot, ontologyLayout } = get()
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
      focusFrames: { ...focusFrames },
      ...(ontologySnapshot ? { ontologySnapshot } : {}),
      ...(ontologyLayout ? { ontologyLayout } : {})
    }
  }
}))
