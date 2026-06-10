import type { CanvasEdge, CanvasNode, CanvasNodeType } from '@shared/canvas-types'
import { useCanvasStore } from '../../store/canvas-store'

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
// CanvasView registers its CommandStack here so non-React call sites (drag
// handlers, the connection overlay, card shells) can push undoable commands.

let activeStack: CommandStack | null = null

export function setActiveCommandStack(stack: CommandStack | null): void {
  activeStack = stack
}

export function getActiveCommandStack(): CommandStack | null {
  return activeStack
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
