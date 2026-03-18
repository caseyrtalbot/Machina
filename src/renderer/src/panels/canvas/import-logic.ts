import type { Artifact, KnowledgeGraph, GraphNode, GraphEdge } from '@shared/types'
import type { CanvasNode, CanvasEdge, CanvasViewport } from '@shared/canvas-types'
import { createCanvasNode, createCanvasEdge } from '@shared/canvas-types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const IMPORT_CAP = 25
export const HUB_COUNT = 15

const GRID_SPACING_X = 360
const GRID_SPACING_Y = 280
const CARD_SIZE = { width: 280, height: 200 }

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TagInfo {
  readonly tag: string
  readonly count: number
}

export type ImportMode =
  | { mode: 'neighborhood'; activeNodeId: string; depth: number }
  | { mode: 'hub' }
  | { mode: 'tag'; tag: string }

// ---------------------------------------------------------------------------
// Tag collection
// ---------------------------------------------------------------------------

export function collectUniqueTags(artifacts: readonly Artifact[]): readonly TagInfo[] {
  const counts = new Map<string, number>()
  for (const artifact of artifacts) {
    for (const tag of artifact.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  const result: TagInfo[] = []
  for (const [tag, count] of counts) {
    result.push({ tag, count })
  }
  return result.sort((a, b) => b.count - a.count)
}

// ---------------------------------------------------------------------------
// ID <-> Path mapping
// ---------------------------------------------------------------------------

export function buildIdToPath(fileToId: Record<string, string>): Map<string, string> {
  const result = new Map<string, string>()
  for (const [path, id] of Object.entries(fileToId)) {
    result.set(id, path)
  }
  return result
}

// ---------------------------------------------------------------------------
// BFS neighborhood traversal
// ---------------------------------------------------------------------------

function buildAdjacency(edges: readonly GraphEdge[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>()
  for (const edge of edges) {
    if (!adj.has(edge.source)) adj.set(edge.source, new Set())
    if (!adj.has(edge.target)) adj.set(edge.target, new Set())
    adj.get(edge.source)!.add(edge.target)
    adj.get(edge.target)!.add(edge.source)
  }
  return adj
}

function bfsNeighborhood(
  graph: KnowledgeGraph,
  startId: string,
  depth: number
): ReadonlySet<string> {
  const adj = buildAdjacency(graph.edges)
  const visited = new Set<string>([startId])
  let frontier = [startId]

  for (let hop = 0; hop < depth; hop++) {
    const next: string[] = []
    for (const nodeId of frontier) {
      const neighbors = adj.get(nodeId) ?? new Set()
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor)
          next.push(neighbor)
        }
      }
    }
    frontier = next
  }

  return visited
}

// ---------------------------------------------------------------------------
// Compute import nodes by mode
// ---------------------------------------------------------------------------

export function computeImportNodes(
  graph: KnowledgeGraph,
  artifacts: readonly Artifact[],
  mode: ImportMode
): { readonly nodes: readonly GraphNode[]; readonly edges: readonly GraphEdge[] } {
  let candidates: readonly GraphNode[]
  const sourceEdges: readonly GraphEdge[] = graph.edges

  switch (mode.mode) {
    case 'neighborhood': {
      const visited = bfsNeighborhood(graph, mode.activeNodeId, mode.depth)
      candidates = graph.nodes.filter((n) => visited.has(n.id))
      break
    }
    case 'hub': {
      const sorted = [...graph.nodes].sort((a, b) => b.connectionCount - a.connectionCount)
      candidates = sorted.slice(0, HUB_COUNT)
      break
    }
    case 'tag': {
      const taggedIds = new Set(artifacts.filter((a) => a.tags.includes(mode.tag)).map((a) => a.id))
      candidates = graph.nodes.filter((n) => taggedIds.has(n.id))
      break
    }
  }

  // Cap and filter edges
  const capped =
    candidates.length <= IMPORT_CAP
      ? candidates
      : [...candidates].sort((a, b) => b.connectionCount - a.connectionCount).slice(0, IMPORT_CAP)

  const selectedIds = new Set(capped.map((n) => n.id))
  const edges = sourceEdges.filter((e) => selectedIds.has(e.source) && selectedIds.has(e.target))

  return { nodes: capped, edges }
}

// ---------------------------------------------------------------------------
// Graph -> Canvas conversion (grid layout)
// ---------------------------------------------------------------------------

export function graphToCanvas(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  idToPath: ReadonlyMap<string, string>,
  origin: { x: number; y: number }
): { nodes: readonly CanvasNode[]; edges: readonly CanvasEdge[] } {
  if (nodes.length === 0) return { nodes: [], edges: [] }

  const columns = Math.ceil(Math.sqrt(nodes.length))
  const graphIdToCanvasId = new Map<string, string>()

  const canvasNodes: CanvasNode[] = nodes.map((gNode, index) => {
    const col = index % columns
    const row = Math.floor(index / columns)
    const position = {
      x: col * GRID_SPACING_X + origin.x,
      y: row * GRID_SPACING_Y + origin.y
    }
    const filePath = idToPath.get(gNode.id) ?? ''
    const cNode = createCanvasNode('note', position, {
      size: { ...CARD_SIZE },
      content: filePath,
      metadata: { graphNodeId: gNode.id, artifactType: gNode.type, signal: gNode.signal }
    })
    graphIdToCanvasId.set(gNode.id, cNode.id)
    return cNode
  })

  const canvasEdges: CanvasEdge[] = []
  for (const gEdge of edges) {
    const fromId = graphIdToCanvasId.get(gEdge.source)
    const toId = graphIdToCanvasId.get(gEdge.target)
    if (fromId && toId) {
      canvasEdges.push(createCanvasEdge(fromId, toId, 'right', 'left'))
    }
  }

  return { nodes: canvasNodes, edges: canvasEdges }
}

// ---------------------------------------------------------------------------
// Viewport fitting
// ---------------------------------------------------------------------------

export function computeImportViewport(
  nodes: readonly CanvasNode[],
  containerWidth: number,
  containerHeight: number
): CanvasViewport {
  if (nodes.length === 0) return { x: 0, y: 0, zoom: 1 }

  const padding = 100
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const node of nodes) {
    const left = node.position.x
    const top = node.position.y
    const right = left + node.size.width
    const bottom = top + node.size.height
    if (left < minX) minX = left
    if (top < minY) minY = top
    if (right > maxX) maxX = right
    if (bottom > maxY) maxY = bottom
  }

  const contentWidth = maxX - minX + padding * 2
  const contentHeight = maxY - minY + padding * 2
  const zoom = Math.min(containerWidth / contentWidth, containerHeight / contentHeight, 1.0)
  const cx = minX + (maxX - minX) / 2
  const cy = minY + (maxY - minY) / 2

  return {
    x: containerWidth / 2 / zoom - cx,
    y: containerHeight / 2 / zoom - cy,
    zoom
  }
}

// ---------------------------------------------------------------------------
// Origin offset (place to right of existing nodes)
// ---------------------------------------------------------------------------

export function computeOriginOffset(existingNodes: readonly CanvasNode[]): number {
  if (existingNodes.length === 0) return 0
  let maxRight = -Infinity
  for (const node of existingNodes) {
    const right = node.position.x + node.size.width
    if (right > maxRight) maxRight = right
  }
  return maxRight + 200
}
