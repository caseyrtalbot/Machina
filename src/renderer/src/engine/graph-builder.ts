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

  // Build title resolution index for wikilinks: normalized title -> artifact ID
  const titleToId = new Map<string, string>()
  for (const a of artifacts) {
    const key = a.title.toLowerCase()
    if (titleToId.has(key)) {
      console.warn(
        `[graph-builder] Duplicate title "${a.title}" (ids: ${titleToId.get(key)}, ${a.id}). Wikilinks will resolve to the last-seen.`
      )
    }
    titleToId.set(key, a.id)
  }

  function edgeKey(source: string, target: string, kind: RelationshipKind): string {
    return kind === 'appears_in'
      ? `${source}->${target}:${kind}`
      : `${[source, target].sort().join('<->')}:${kind}`
  }

  function addEdge(source: string, target: string, kind: RelationshipKind): void {
    const key = edgeKey(source, target, kind)
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

  // Check if any explicit edge already exists between two nodes (any kind)
  function hasExplicitEdge(source: string, target: string): boolean {
    const sorted = [source, target].sort()
    const pairKey = sorted.join('<->')
    for (const kind of ['connection', 'cluster', 'tension', 'appears_in'] as const) {
      const key = kind === 'appears_in'
        ? `${source}->${target}:${kind}`
        : `${pairKey}:${kind}`
      if (edgeSet.has(key)) return true
      // Also check reverse direction for appears_in
      if (kind === 'appears_in') {
        if (edgeSet.has(`${target}->${source}:${kind}`)) return true
      }
    }
    return false
  }

  // Build edges from explicit frontmatter relationships
  for (const a of artifacts) {
    for (const id of a.connections) addEdge(a.id, id, 'connection')
    for (const id of a.clusters_with) addEdge(a.id, id, 'cluster')
    for (const id of a.tensions_with) addEdge(a.id, id, 'tension')
    for (const id of a.appears_in) addEdge(a.id, id, 'appears_in')
  }

  // Build edges from wikilinks in body text
  for (const a of artifacts) {
    for (const target of a.wikilinks) {
      const resolvedId = titleToId.get(target.toLowerCase())
      if (resolvedId) {
        // Skip self-links
        if (resolvedId === a.id) continue
        // Skip if explicit frontmatter edge already exists between these nodes
        if (hasExplicitEdge(a.id, resolvedId)) continue
        addEdge(a.id, resolvedId, 'wikilink')
      } else {
        // Ghost node: use normalized target as ID
        const ghostId = `ghost:${target}`
        if (!nodes.has(ghostId)) {
          nodes.set(ghostId, {
            id: ghostId,
            title: target,
            type: 'note',
            signal: 'untested',
            connectionCount: 0
          })
        }
        addEdge(a.id, ghostId, 'wikilink')
      }
    }
  }

  // Build tag nodes and edges
  const tagArtifacts = new Map<string, string[]>()
  for (const a of artifacts) {
    for (const tag of a.tags) {
      const normalized = tag.toLowerCase()
      const list = tagArtifacts.get(normalized) ?? []
      list.push(a.id)
      tagArtifacts.set(normalized, list)
    }
  }

  for (const [normalizedTag, artifactIds] of tagArtifacts) {
    const tagNodeId = `tag:${normalizedTag}`
    nodes.set(tagNodeId, {
      id: tagNodeId,
      title: `#${normalizedTag}`,
      type: 'tag',
      signal: 'core',
      connectionCount: 0
    })
    for (const artifactId of artifactIds) {
      addEdge(artifactId, tagNodeId, 'tag')
    }
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
