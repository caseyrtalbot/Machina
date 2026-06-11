import {
  createCanvasNode,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNodeType
} from '@shared/canvas-types'
import { getActiveCanvasId, useCanvasStore } from '../../store/canvas-store'

export interface Command {
  execute: () => void | Promise<void>
  undo: () => void | Promise<void>
}

export class CommandStack {
  private stack: Command[] = []
  private index = -1
  private maxSize: number

  constructor(maxSize = 100) {
    this.maxSize = maxSize
  }

  execute(cmd: Command): void {
    cmd.execute()
    // Discard any redo history
    this.stack = this.stack.slice(0, this.index + 1)
    this.stack.push(cmd)
    this.index++

    // Cap size
    if (this.stack.length > this.maxSize) {
      const excess = this.stack.length - this.maxSize
      this.stack = this.stack.slice(excess)
      this.index -= excess
    }
  }

  async undo(): Promise<void> {
    if (!this.canUndo()) return
    await this.stack[this.index].undo()
    this.index--
  }

  async redo(): Promise<void> {
    if (!this.canRedo()) return
    this.index++
    await this.stack[this.index].execute()
  }

  canUndo(): boolean {
    return this.index >= 0
  }

  canRedo(): boolean {
    return this.index < this.stack.length - 1
  }

  clear(): void {
    this.stack = []
    this.index = -1
  }
}

// ── Active stack registry ────────────────────────────────────────────────────
// Each CanvasView registers its CommandStack under its canvasId so non-React
// call sites (drag handlers, the connection overlay, card shells) can push
// undoable commands. The active stack resolves through the active-canvas
// indirection — never "last mounted view wins": with two KeepAlive-mounted
// canvases, commands must land on the stack of the canvas the user is acting
// on, not whichever view mounted last.

const stacksByCanvasId = new Map<string, CommandStack>()

export function registerCommandStack(canvasId: string, stack: CommandStack): () => void {
  stacksByCanvasId.set(canvasId, stack)
  return () => {
    if (stacksByCanvasId.get(canvasId) === stack) stacksByCanvasId.delete(canvasId)
  }
}

export function getActiveCommandStack(): CommandStack | null {
  return stacksByCanvasId.get(getActiveCanvasId()) ?? null
}

// ── Command builders ─────────────────────────────────────────────────────────
// Each captures the state needed for undo at build time, then mutates through
// the canvas store. Builders return null when there is nothing to do.

interface Position {
  readonly x: number
  readonly y: number
}

interface Size {
  readonly width: number
  readonly height: number
}

/** Remove nodes; undo restores them along with their attached edges. */
export function removeNodesCommand(ids: readonly string[]): Command | null {
  const s = useCanvasStore.getState()
  const idSet = new Set(ids)
  const nodes = s.nodes.filter((n) => idSet.has(n.id))
  if (nodes.length === 0) return null
  const edges = s.edges.filter((e) => idSet.has(e.fromNode) || idSet.has(e.toNode))
  return {
    execute: () => {
      const store = useCanvasStore.getState()
      for (const n of nodes) store.removeNode(n.id)
    },
    undo: () => useCanvasStore.getState().addNodesAndEdges(nodes, edges)
  }
}

/**
 * Removal driven by a card's own close callback (terminal cards kill their
 * PTY before removing). Undo restores the node and its attached edges.
 */
export function removeNodeViaCallback(nodeId: string, performRemoval: () => void): Command | null {
  const s = useCanvasStore.getState()
  const node = s.nodes.find((n) => n.id === nodeId)
  if (!node) return null
  const edges = s.edges.filter((e) => e.fromNode === nodeId || e.toNode === nodeId)
  return {
    execute: performRemoval,
    undo: () => {
      // The close callback may no-op (e.g. terminal close during an in-flight
      // restart) — restoring then would duplicate the still-present node.
      const store = useCanvasStore.getState()
      if (store.nodes.some((n) => n.id === nodeId)) return
      store.addNodesAndEdges([node], edges)
    }
  }
}

export function addEdgeCommand(edge: CanvasEdge): Command {
  return {
    execute: () => useCanvasStore.getState().addEdge(edge),
    undo: () => useCanvasStore.getState().removeEdge(edge.id)
  }
}

export function removeEdgeCommand(edgeId: string): Command | null {
  const edge = useCanvasStore.getState().edges.find((e) => e.id === edgeId)
  if (!edge) return null
  return {
    execute: () => useCanvasStore.getState().removeEdge(edgeId),
    undo: () => useCanvasStore.getState().addEdge(edge)
  }
}

/** Node plus connecting edge created in one gesture (edge drag onto empty canvas). */
export function addNodeWithEdgeCommand(node: CanvasNode, edge: CanvasEdge): Command {
  return {
    execute: () => useCanvasStore.getState().addNodesAndEdges([node], [edge]),
    undo: () => {
      const s = useCanvasStore.getState()
      s.removeEdge(edge.id)
      s.removeNode(node.id)
    }
  }
}

/**
 * Move with known before/after positions (drag-end). Execute re-applies the
 * end positions, so pushing after an interactive drag is a visual no-op.
 */
export function moveNodesCommand(
  before: ReadonlyMap<string, Position>,
  after: ReadonlyMap<string, Position>
): Command {
  return {
    execute: () => useCanvasStore.getState().moveNodes(after),
    undo: () => useCanvasStore.getState().moveNodes(before)
  }
}

/** Resize with known before/after sizes (resize-end). Execute is idempotent. */
export function resizeNodeCommand(nodeId: string, before: Size, after: Size): Command {
  return {
    execute: () => useCanvasStore.getState().resizeNode(nodeId, after),
    undo: () => useCanvasStore.getState().resizeNode(nodeId, before)
  }
}

/** Type conversion; undo restores the node's prior type, content, and metadata. */
export function convertNodeTypeCommand(nodeId: string, target: CanvasNodeType): Command | null {
  const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId)
  if (!node || node.type === target) return null
  const prior = { type: node.type, content: node.content, metadata: node.metadata }
  return {
    execute: () => useCanvasStore.getState().updateNodeType(nodeId, target),
    undo: () =>
      useCanvasStore.setState((s) => ({
        nodes: s.nodes.map((n) => (n.id === nodeId ? { ...n, ...prior } : n)),
        isDirty: true
      }))
  }
}

/**
 * Wrap a layout pass (tile/semantic) so undo restores every node's prior
 * position and the prior cluster labels.
 */
export function layoutCommand(applyLayout: () => void): Command | null {
  const s = useCanvasStore.getState()
  if (s.nodes.length === 0) return null
  const before = new Map<string, Position>()
  for (const n of s.nodes) before.set(n.id, { x: n.position.x, y: n.position.y })
  const labelsBefore = s.clusterLabels
  return {
    execute: applyLayout,
    undo: () => {
      useCanvasStore.getState().moveNodes(before)
      useCanvasStore.setState({ clusterLabels: labelsBefore })
    }
  }
}

/**
 * Nudge nodes by a fixed delta (arrow keys). Captures before/after at build
 * time so undo/redo replay exact positions. Returns null when nothing moves.
 */
export function nudgeNodesCommand(ids: readonly string[], dx: number, dy: number): Command | null {
  if (dx === 0 && dy === 0) return null
  const idSet = new Set(ids)
  const before = new Map<string, Position>()
  const after = new Map<string, Position>()
  for (const n of useCanvasStore.getState().nodes) {
    if (!idSet.has(n.id)) continue
    before.set(n.id, { x: n.position.x, y: n.position.y })
    after.set(n.id, { x: n.position.x + dx, y: n.position.y + dy })
  }
  if (before.size === 0) return null
  return moveNodesCommand(before, after)
}

// ── Duplicate / copy / paste ─────────────────────────────────────────────────
// Clones get fresh ids at command-build time so redo re-inserts the same
// nodes the undo removed. Edges are cloned only when both endpoints are in
// the cloned set. The clipboard is canvas-internal (not the OS clipboard).

const CLONE_OFFSET = 24

function cloneNodesAndEdges(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  offset: number
): { nodes: readonly CanvasNode[]; edges: readonly CanvasEdge[] } {
  const idMap = new Map<string, string>()
  const clonedNodes = nodes.map((n) => {
    // isActive is runtime-only; a terminal's content is a live PTY session id
    // — a clone must never attach to the original's session.
    const { isActive: _ignored, ...metadata } = n.metadata
    const clone = createCanvasNode(
      n.type,
      { x: n.position.x + offset, y: n.position.y + offset },
      {
        size: { ...n.size },
        content: n.type === 'terminal' ? '' : n.content,
        metadata
      }
    )
    idMap.set(n.id, clone.id)
    return clone
  })
  const clonedEdges = edges
    .filter((e) => idMap.has(e.fromNode) && idMap.has(e.toNode))
    .map((e) => ({
      ...e,
      // Fresh id (same source as the canvas-types factories); endpoints
      // remapped to the clones.
      id: globalThis.crypto.randomUUID(),
      fromNode: idMap.get(e.fromNode) as string,
      toNode: idMap.get(e.toNode) as string
    }))
  return { nodes: clonedNodes, edges: clonedEdges }
}

/** Insert pre-built clones; execute selects them, undo removes them. */
function insertClonesCommand(nodes: readonly CanvasNode[], edges: readonly CanvasEdge[]): Command {
  const nodeIds = new Set(nodes.map((n) => n.id))
  const edgeIds = new Set(edges.map((e) => e.id))
  return {
    execute: () => {
      const s = useCanvasStore.getState()
      s.addNodesAndEdges(nodes, edges)
      s.setSelection(new Set(nodeIds))
    },
    undo: () => {
      // Route through removeNode (not a raw setState filter): a duplicated
      // terminal clone spawns its own PTY which must be killed, and any
      // focus/lock/selection pointing at a clone must be cleared.
      const store = useCanvasStore.getState()
      for (const id of nodeIds) store.removeNode(id)
      // Backstop for cloned edges (today both endpoints are always clones,
      // so removeNode has already dropped them).
      useCanvasStore.setState((s) => ({
        edges: s.edges.filter((e) => !edgeIds.has(e.id))
      }))
    }
  }
}

/** ⌘D: offset clones of the current selection, which become the selection. */
export function duplicateSelectionCommand(): Command | null {
  const s = useCanvasStore.getState()
  const selected = s.nodes.filter((n) => s.selectedNodeIds.has(n.id))
  if (selected.length === 0) return null
  const clones = cloneNodesAndEdges(selected, s.edges, CLONE_OFFSET)
  return insertClonesCommand(clones.nodes, clones.edges)
}

interface CanvasClipboard {
  readonly nodes: readonly CanvasNode[]
  readonly edges: readonly CanvasEdge[]
}

let clipboard: CanvasClipboard | null = null
let pasteSerial = 0

/** ⌘C: snapshot the selection (and intra-selection edges). Returns the count copied. */
export function copySelectionToClipboard(): number {
  const s = useCanvasStore.getState()
  const selected = s.nodes.filter((n) => s.selectedNodeIds.has(n.id))
  if (selected.length === 0) return 0
  const ids = new Set(selected.map((n) => n.id))
  clipboard = {
    nodes: selected,
    edges: s.edges.filter((e) => ids.has(e.fromNode) && ids.has(e.toNode))
  }
  pasteSerial = 0
  return selected.length
}

/** ⌘V: insert fresh-id clones of the clipboard, cascading the offset per paste. */
export function pasteClipboardCommand(): Command | null {
  if (!clipboard || clipboard.nodes.length === 0) return null
  pasteSerial += 1
  const clones = cloneNodesAndEdges(clipboard.nodes, clipboard.edges, CLONE_OFFSET * pasteSerial)
  return insertClonesCommand(clones.nodes, clones.edges)
}

/** Test hook: reset the module-level clipboard between cases. */
export function clearCanvasClipboard(): void {
  clipboard = null
  pasteSerial = 0
}

/** Clear everything; undo restores nodes, edges, ontology, and cluster labels. */
export function clearCanvasCommand(): Command {
  const s = useCanvasStore.getState()
  const prior = {
    nodes: s.nodes,
    edges: s.edges,
    ontologySnapshot: s.ontologySnapshot,
    ontologyLayout: s.ontologyLayout,
    ontologyIsStale: s.ontologyIsStale,
    clusterLabels: s.clusterLabels
  }
  return {
    execute: () =>
      useCanvasStore.setState({
        nodes: [],
        edges: [],
        selectedNodeIds: new Set(),
        selectedEdgeId: null,
        focusedCardId: null,
        lockedCardId: null,
        ontologySnapshot: null,
        ontologyLayout: null,
        ontologyIsStale: false,
        clusterLabels: [],
        isDirty: true
      }),
    undo: () => useCanvasStore.setState({ ...prior, isDirty: true })
  }
}
