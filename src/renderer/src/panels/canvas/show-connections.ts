import type { KnowledgeGraph } from '@shared/types'
import type { CanvasNode, CanvasEdge, CanvasEdgeKind } from '@shared/canvas-types'
import { createCanvasNode, createCanvasEdge } from '@shared/canvas-types'

const CANVAS_EDGE_KINDS = new Set<string>(['connection', 'cluster', 'tension'])

const RADIAL_DISTANCE = 350
const CARD_SIZE = { width: 280, height: 200 }

export interface ShowConnectionsResult {
  readonly newNodes: readonly CanvasNode[]
  readonly newEdges: readonly CanvasEdge[]
}

export function computeShowConnections(
  canvasNode: CanvasNode,
  existingNodes: readonly CanvasNode[],
  graph: KnowledgeGraph,
  fileToId: Readonly<Record<string, string>>
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
    const edgeKind = CANVAS_EDGE_KINDS.has(edge.kind) ? (edge.kind as CanvasEdgeKind) : undefined
    // Deduplicate by neighbor ID
    if (!neighbors.some((n) => n.id === neighborId)) {
      neighbors.push({ id: neighborId, kind: edgeKind })
    }
  }

  // Create new nodes in radial layout around the source card
  const centerX = canvasNode.position.x + canvasNode.size.width / 2
  const centerY = canvasNode.position.y + canvasNode.size.height / 2
  const angleStep = (2 * Math.PI) / neighbors.length

  const newNodes: CanvasNode[] = []
  const newEdges: CanvasEdge[] = []
  const neighborCanvasIds = new Map<string, string>()

  // Map existing canvas nodes by their content (file path) to canvas ID
  const pathToCanvasId = new Map<string, string>()
  for (const n of existingNodes) {
    pathToCanvasId.set(n.content, n.id)
  }

  for (let i = 0; i < neighbors.length; i++) {
    const neighbor = neighbors[i]
    const neighborPath = idToFile.get(neighbor.id)
    if (!neighborPath) continue

    let targetCanvasId: string

    if (existingPaths.has(neighborPath)) {
      // Node already on canvas; just create an edge to it
      targetCanvasId = pathToCanvasId.get(neighborPath)!
    } else {
      // Create new card at radial position
      const angle = angleStep * i - Math.PI / 2
      const x = centerX + Math.cos(angle) * RADIAL_DISTANCE - CARD_SIZE.width / 2
      const y = centerY + Math.sin(angle) * RADIAL_DISTANCE - CARD_SIZE.height / 2

      const newNode = createCanvasNode(
        'note',
        { x, y },
        {
          size: { ...CARD_SIZE },
          content: neighborPath,
          metadata: { graphNodeId: neighbor.id }
        }
      )
      newNodes.push(newNode)
      targetCanvasId = newNode.id
      pathToCanvasId.set(neighborPath, newNode.id)
    }

    neighborCanvasIds.set(neighbor.id, targetCanvasId)

    // Create typed edge from source to neighbor
    newEdges.push(createCanvasEdge(canvasNode.id, targetCanvasId, 'right', 'left', neighbor.kind))
  }

  return { newNodes, newEdges }
}
