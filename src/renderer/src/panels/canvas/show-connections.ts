import type { Artifact, KnowledgeGraph } from '@shared/types'
import type { CanvasNode, CanvasEdge, CanvasEdgeKind } from '@shared/canvas-types'
import { createCanvasNode, createCanvasEdge, CANVAS_EDGE_KINDS } from '@shared/canvas-types'
import {
  computeCardSize,
  computeForceLayout,
  computeOptimalEdgeSides,
  type ContentMetrics
} from './canvas-layout'

interface ShowConnectionsResult {
  readonly newNodes: readonly CanvasNode[]
  readonly newEdges: readonly CanvasEdge[]
}

export function computeShowConnections(
  canvasNode: CanvasNode,
  existingNodes: readonly CanvasNode[],
  graph: KnowledgeGraph,
  fileToId: Readonly<Record<string, string>>,
  artifacts: readonly Artifact[]
): ShowConnectionsResult {
  const filePath = canvasNode.content
  const idToFile = new Map<string, string>()
  for (const [path, id] of Object.entries(fileToId)) {
    idToFile.set(id, path)
  }

  const artifactId = fileToId[filePath]
  if (!artifactId) return { newNodes: [], newEdges: [] }

  // Find all edges involving this artifact
  const relatedEdges = graph.edges.filter((e) => e.source === artifactId || e.target === artifactId)

  if (relatedEdges.length === 0) return { newNodes: [], newEdges: [] }

  // Build set of file paths already on canvas to avoid duplicates
  const existingPaths = new Set(existingNodes.map((n) => n.content))

  // Collect unique neighbor IDs and their edge kinds
  const neighbors: { id: string; kind: CanvasEdgeKind | undefined }[] = []
  for (const edge of relatedEdges) {
    const neighborId = edge.source === artifactId ? edge.target : edge.source
    const edgeKind = CANVAS_EDGE_KINDS.has(edge.kind as CanvasEdgeKind)
      ? (edge.kind as CanvasEdgeKind)
      : undefined
    if (!neighbors.some((n) => n.id === neighborId)) {
      neighbors.push({ id: neighborId, kind: edgeKind })
    }
  }

  // Build artifact lookup for content-adaptive sizing
  const artifactById = new Map<string, Artifact>()
  for (const a of artifacts) {
    artifactById.set(a.id, a)
  }

  // Map existing canvas nodes by their content (file path) to canvas ID
  const pathToCanvasId = new Map<string, string>()
  for (const n of existingNodes) {
    pathToCanvasId.set(n.content, n.id)
  }

  // Phase 1: Determine which neighbors need new cards and compute their sizes
  interface PendingNode {
    readonly neighborId: string
    readonly neighborPath: string
    readonly kind: CanvasEdgeKind | undefined
    readonly size: { width: number; height: number }
    readonly tempId: string
  }

  const pendingNodes: PendingNode[] = []
  const existingEdgeTargets: { canvasId: string; kind: CanvasEdgeKind | undefined }[] = []

  for (const neighbor of neighbors) {
    const neighborPath = idToFile.get(neighbor.id)
    if (!neighborPath) continue

    if (existingPaths.has(neighborPath)) {
      existingEdgeTargets.push({
        canvasId: pathToCanvasId.get(neighborPath)!,
        kind: neighbor.kind
      })
    } else {
      // Compute content-adaptive size from artifact data
      const artifact = artifactById.get(neighbor.id)
      const metrics: ContentMetrics = {
        titleLength: artifact?.title?.length ?? 0,
        bodyLength: artifact?.body?.length ?? 0,
        metadataCount: artifact ? Object.keys(artifact.frontmatter).length : 0
      }
      const size = computeCardSize(metrics)

      // Use a temporary ID for force layout (real ID assigned when createCanvasNode is called)
      const tempId = `pending_${neighbor.id}`
      pendingNodes.push({
        neighborId: neighbor.id,
        neighborPath,
        kind: neighbor.kind,
        size,
        tempId
      })
    }
  }

  // Phase 2: Compute force-directed positions for all new cards simultaneously
  const layoutResult = computeForceLayout({
    sourceNode: canvasNode,
    newNodes: pendingNodes.map((p) => ({ id: p.tempId, size: p.size })),
    existingNodes
  })

  // Phase 3: Create nodes at computed positions with optimal edge sides
  const newNodes: CanvasNode[] = []
  const newEdges: CanvasEdge[] = []

  for (const pending of pendingNodes) {
    const pos = layoutResult.positions.get(pending.tempId) ?? { x: 0, y: 0 }

    const newNode = createCanvasNode('note', pos, {
      size: { ...pending.size },
      content: pending.neighborPath,
      metadata: { graphNodeId: pending.neighborId }
    })
    newNodes.push(newNode)
    pathToCanvasId.set(pending.neighborPath, newNode.id)

    // Compute edge sides from actual positions
    const targetRect = { position: pos, size: pending.size }
    const { fromSide, toSide } = computeOptimalEdgeSides(canvasNode, targetRect)
    newEdges.push(createCanvasEdge(canvasNode.id, newNode.id, fromSide, toSide, pending.kind))
  }

  // Phase 4: Create edges to nodes that already existed on canvas
  for (const existing of existingEdgeTargets) {
    const existingNode = existingNodes.find((n) => n.id === existing.canvasId)
    if (existingNode) {
      const { fromSide, toSide } = computeOptimalEdgeSides(canvasNode, existingNode)
      newEdges.push(
        createCanvasEdge(canvasNode.id, existing.canvasId, fromSide, toSide, existing.kind)
      )
    } else {
      newEdges.push(
        createCanvasEdge(canvasNode.id, existing.canvasId, 'right', 'left', existing.kind)
      )
    }
  }

  return { newNodes, newEdges }
}
