import type {
  Artifact,
  GraphNode,
  GraphEdge,
  KnowledgeGraph,
  RelationshipKind
} from '@shared/types'

/** Hard cap: terms appearing in this many files or more are skipped. */
const TERM_FREQ_CAP = 20

/** Minimum co-occurrence edge weight to include. */
const MIN_EDGE_WEIGHT = 0.3

/**
 * Build a unified term set for an artifact: tags + concepts, normalized to lowercase.
 * Deduplicates naturally via Set.
 */
function buildTermSet(artifact: Artifact): ReadonlySet<string> {
  const terms = new Set<string>()
  for (const tag of artifact.tags) terms.add(tag.toLowerCase())
  for (const concept of artifact.concepts) terms.add(concept.toLowerCase())
  return terms
}

export function buildGraph(artifacts: readonly Artifact[]): KnowledgeGraph {
  const nodes = new Map<string, GraphNode>()
  const edgeSet = new Set<string>()
  const edges: GraphEdge[] = []

  // Create nodes from artifacts only (no tag nodes, no ghost nodes)
  for (const a of artifacts) {
    nodes.set(a.id, {
      id: a.id,
      title: a.title,
      type: a.type,
      signal: a.signal,
      connectionCount: 0,
      tags: [...a.tags],
      created: a.created
    })
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

    // Create placeholder node for missing frontmatter reference
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

  // Check if any explicit edge already exists between two nodes
  function hasExplicitEdge(source: string, target: string): boolean {
    const sorted = [source, target].sort()
    const pairKey = sorted.join('<->')
    for (const kind of ['connection', 'cluster', 'tension', 'appears_in', 'related'] as const) {
      const key = kind === 'appears_in' ? `${source}->${target}:${kind}` : `${pairKey}:${kind}`
      if (edgeSet.has(key)) return true
      if (kind === 'appears_in') {
        if (edgeSet.has(`${target}->${source}:${kind}`)) return true
      }
    }
    return false
  }

  // Phase 1: Explicit frontmatter edges
  for (const a of artifacts) {
    for (const id of a.connections) addEdge(a.id, id, 'connection')
    for (const id of a.clusters_with) addEdge(a.id, id, 'cluster')
    for (const id of a.tensions_with) addEdge(a.id, id, 'tension')
    for (const id of a.appears_in) addEdge(a.id, id, 'appears_in')
    for (const id of a.related) addEdge(a.id, id, 'related')
  }

  // Phase 2: Co-occurrence edges from shared terms
  const termSets = new Map<string, ReadonlySet<string>>()
  const termFreq = new Map<string, number>()

  for (const a of artifacts) {
    const terms = buildTermSet(a)
    termSets.set(a.id, terms)
    for (const term of terms) {
      termFreq.set(term, (termFreq.get(term) ?? 0) + 1)
    }
  }

  // Invert: for each term, collect the artifact IDs that contain it
  const termToArtifacts = new Map<string, string[]>()
  for (const a of artifacts) {
    const terms = termSets.get(a.id)!
    for (const term of terms) {
      const freq = termFreq.get(term)!
      if (freq >= TERM_FREQ_CAP) continue
      if (freq < 2) continue
      const list = termToArtifacts.get(term) ?? []
      list.push(a.id)
      termToArtifacts.set(term, list)
    }
  }

  // Accumulate edge weights between artifact pairs
  const pairWeights = new Map<string, number>()
  for (const [term, ids] of termToArtifacts) {
    const freq = termFreq.get(term)!
    const weight = 1 / Math.log2(freq)
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const pk = [ids[i], ids[j]].sort().join('<->')
        pairWeights.set(pk, (pairWeights.get(pk) ?? 0) + weight)
      }
    }
  }

  // Create co-occurrence edges above the minimum weight
  for (const [pairKey, weight] of pairWeights) {
    if (weight < MIN_EDGE_WEIGHT) continue
    const [a, b] = pairKey.split('<->')
    if (hasExplicitEdge(a, b)) continue
    addEdge(a, b, 'co-occurrence')
  }

  // Phase 3: Count connections per node
  const connectionCounts = new Map<string, number>()
  for (const edge of edges) {
    if (nodes.has(edge.source)) {
      connectionCounts.set(edge.source, (connectionCounts.get(edge.source) ?? 0) + 1)
    }
    if (nodes.has(edge.target) && edge.kind !== 'appears_in') {
      connectionCounts.set(edge.target, (connectionCounts.get(edge.target) ?? 0) + 1)
    }
  }

  const finalNodes = Array.from(nodes.values()).map((node) => ({
    ...node,
    connectionCount: connectionCounts.get(node.id) ?? 0
  }))

  return { nodes: finalNodes, edges }
}
