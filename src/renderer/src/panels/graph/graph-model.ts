import type { KnowledgeGraph, GraphNode, GraphEdge } from '@shared/types'

export interface GraphModel {
  readonly nodes: readonly GraphNode[]
  readonly edges: readonly GraphEdge[]
}

export interface GraphFilters {
  showOrphans: boolean
  showExistingOnly: boolean
  searchQuery: string
}

function getNodeId(node: GraphNode): string {
  return node.id
}

function applyFilters(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  filters: GraphFilters
): GraphModel {
  // Step 1: filter nodes
  let filteredNodes = nodes.filter((node) => {
    if (filters.showExistingOnly && node.id.startsWith('ghost:')) return false
    return true
  })

  // Step 2: filter edges — both endpoints must survive the node filter
  const survivingIds = new Set(filteredNodes.map(getNodeId))

  const filteredEdges = edges.filter((edge) => {
    const sourceId = String(edge.source)
    const targetId = String(edge.target)
    return survivingIds.has(sourceId) && survivingIds.has(targetId)
  })

  // Step 3: orphan filter — remove nodes with no edges AND connectionCount === 0
  if (!filters.showOrphans) {
    const connectedIds = new Set<string>()
    for (const edge of filteredEdges) {
      connectedIds.add(String(edge.source))
      connectedIds.add(String(edge.target))
    }

    filteredNodes = filteredNodes.filter((node) => {
      return connectedIds.has(node.id) || node.connectionCount > 0
    })
  }

  return { nodes: filteredNodes, edges: filteredEdges }
}

export function buildGlobalGraphModel(graph: KnowledgeGraph, filters: GraphFilters): GraphModel {
  return applyFilters(graph.nodes, graph.edges, filters)
}

export function buildLocalGraphModel(
  graph: KnowledgeGraph,
  activeNodeId: string,
  depth: number,
  filters: GraphFilters
): GraphModel {
  // Check that the active node exists
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]))
  if (!nodeMap.has(activeNodeId)) {
    return { nodes: [], edges: [] }
  }

  // Build bidirectional adjacency list
  const adjacency = new Map<string, Set<string>>()
  for (const edge of graph.edges) {
    const src = String(edge.source)
    const tgt = String(edge.target)
    if (!adjacency.has(src)) adjacency.set(src, new Set())
    if (!adjacency.has(tgt)) adjacency.set(tgt, new Set())
    adjacency.get(src)!.add(tgt)
    adjacency.get(tgt)!.add(src)
  }

  // BFS from activeNodeId up to `depth` hops
  const visited = new Set<string>()
  let frontier = [activeNodeId]
  visited.add(activeNodeId)

  for (let hop = 0; hop < depth; hop++) {
    const next: string[] = []
    for (const nodeId of frontier) {
      const neighbors = adjacency.get(nodeId)
      if (!neighbors) continue
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor)
          next.push(neighbor)
        }
      }
    }
    frontier = next
  }

  // Collect subgraph nodes (only those that exist in the node map)
  const subNodes = graph.nodes.filter((n) => visited.has(n.id))

  // Collect subgraph edges where both endpoints are in the visited set
  const subEdges = graph.edges.filter((edge) => {
    return visited.has(String(edge.source)) && visited.has(String(edge.target))
  })

  return applyFilters(subNodes, subEdges, filters)
}
