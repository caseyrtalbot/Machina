import type { ClusterDraft, ClusterSection } from '@shared/cluster-types'
import type { CanvasNode, CanvasEdge } from '@shared/canvas-types'

interface CanvasSnapshotForCluster {
  readonly nodes: readonly CanvasNode[]
  readonly edges: readonly CanvasEdge[]
  /** cluster_id -> source artifact IDs consumed by that agent run */
  readonly agentSources: Readonly<Record<string, readonly string[]>>
  readonly userTitle?: string
}

function cardTitle(node: CanvasNode): string {
  const fromMeta = node.metadata['title']
  if (typeof fromMeta === 'string' && fromMeta.trim()) return fromMeta.trim()
  return ''
}

function cardBody(node: CanvasNode): string {
  return node.content ?? ''
}

function byPosition(a: CanvasNode, b: CanvasNode): number {
  if (a.position.y !== b.position.y) return a.position.y - b.position.y
  return a.position.x - b.position.x
}

function connectedComponent(
  rootId: string,
  edges: readonly CanvasEdge[],
  nodeIds: ReadonlySet<string>
): Set<string> {
  const adj = new Map<string, Set<string>>()
  for (const e of edges) {
    if (!nodeIds.has(e.fromNode) || !nodeIds.has(e.toNode)) continue
    if (!adj.has(e.fromNode)) adj.set(e.fromNode, new Set())
    if (!adj.has(e.toNode)) adj.set(e.toNode, new Set())
    adj.get(e.fromNode)!.add(e.toNode)
    adj.get(e.toNode)!.add(e.fromNode)
  }
  const seen = new Set<string>([rootId])
  const stack = [rootId]
  while (stack.length) {
    const cur = stack.pop()!
    for (const nxt of adj.get(cur) ?? []) {
      if (seen.has(nxt)) continue
      seen.add(nxt)
      stack.push(nxt)
    }
  }
  return seen
}

export function buildClusterDraft(
  rootCardId: string | null,
  selection: readonly string[],
  snapshot: CanvasSnapshotForCluster
): ClusterDraft {
  const nodeById = new Map(snapshot.nodes.map((n) => [n.id, n]))
  let memberIds: string[]

  if (rootCardId) {
    const root = nodeById.get(rootCardId)
    if (!root) throw new Error(`root card ${rootCardId} not found`)
    const idSet = new Set(snapshot.nodes.map((n) => n.id))
    const component = connectedComponent(rootCardId, snapshot.edges, idSet)
    memberIds = [...component]
  } else {
    memberIds = [...selection]
  }

  const memberNodes = memberIds
    .map((id) => nodeById.get(id))
    .filter((n): n is CanvasNode => Boolean(n))

  let ordered: CanvasNode[]
  let rootNode: CanvasNode | undefined
  if (rootCardId) {
    rootNode = memberNodes.find((n) => n.id === rootCardId)
    ordered = memberNodes.filter((n) => n.id !== rootCardId).sort(byPosition)
  } else {
    ordered = [...memberNodes].sort(byPosition)
  }

  const sections: ClusterSection[] = ordered.map((n, i) => ({
    cardId: n.id,
    heading: cardTitle(n) || `Section ${i + 1}`,
    body: cardBody(n)
  }))

  const isAgent = Boolean(rootCardId) && rootNode?.metadata.origin === 'agent'
  const clusterId = (rootNode?.metadata.cluster_id as string | undefined) ?? null
  const agentSources = clusterId ? (snapshot.agentSources[clusterId] ?? []) : []

  const title = isAgent
    ? cardTitle(rootNode!) || 'Agent cluster'
    : (snapshot.userTitle ?? 'Cluster')

  return {
    kind: 'cluster',
    title,
    prompt: isAgent ? cardBody(rootNode!) : '',
    origin: isAgent ? 'agent' : 'human',
    sources: agentSources,
    sections
  }
}
