import type {
  Artifact,
  GraphNode,
  GraphEdge,
  KnowledgeGraph,
  RelationshipKind
} from '@shared/types'

export function buildGraph(artifacts: readonly Artifact[]): KnowledgeGraph {
  const nodes = new Map<string, GraphNode>()
  const edgeSet = new Set<string>()
  const edges: GraphEdge[] = []

  // Create nodes from artifacts
  for (const a of artifacts) {
    nodes.set(a.id, {
      id: a.id,
      title: a.title,
      type: a.type,
      signal: a.signal,
      connectionCount: 0
    })
  }

  function addEdge(source: string, target: string, kind: RelationshipKind): void {
    // For non-directional edges, normalize key order to deduplicate
    const key =
      kind === 'appears_in'
        ? `${source}->${target}:${kind}`
        : `${[source, target].sort().join('<->')}:${kind}`

    if (edgeSet.has(key)) return
    edgeSet.add(key)

    // Create ghost node for missing reference
    if (!nodes.has(target)) {
      nodes.set(target, {
        id: target,
        title: target,
        type: 'note',
        signal: 'untested',
        connectionCount: 0
      })
    }

    edges.push({ source, target, kind })
  }

  // Build edges from relationships
  for (const a of artifacts) {
    for (const id of a.connections) addEdge(a.id, id, 'connection')
    for (const id of a.clusters_with) addEdge(a.id, id, 'cluster')
    for (const id of a.tensions_with) addEdge(a.id, id, 'tension')
    for (const id of a.appears_in) addEdge(a.id, id, 'appears_in')
  }

  // Count connections per node
  for (const edge of edges) {
    const sourceNode = nodes.get(edge.source)
    const targetNode = nodes.get(edge.target)
    if (sourceNode) sourceNode.connectionCount++
    if (targetNode && edge.kind !== 'appears_in') targetNode.connectionCount++
  }

  return { nodes: Array.from(nodes.values()), edges }
}
