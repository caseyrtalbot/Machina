/**
 * Serialize a KnowledgeGraph into a compact text summary for agent context.
 *
 * Instead of feeding an agent 500 full files, give it this summary (~20KB)
 * so it can place new nodes relative to the existing structure.
 */

import type { KnowledgeGraph, GraphNode, GraphEdge } from '@shared/types'

export interface GraphSummaryOptions {
  /** Max nodes to include (default: all) */
  readonly maxNodes?: number
  /** Include tag clusters section (default: true) */
  readonly includeTags?: boolean
}

/**
 * Produce a compact text representation of the graph.
 *
 * Format:
 * ```
 * # Vault Graph Summary (147 nodes, 203 edges)
 *
 * ## Nodes
 * - g01 "Mental Models" [gene] tags:thinking,decisions signal:validated (5 edges)
 * ...
 *
 * ## Edges
 * g01 --connection--> g02
 * ...
 *
 * ## Tag Clusters
 * thinking: g01, g05, g12
 * ...
 * ```
 */
export function serializeGraphSummary(
  graph: KnowledgeGraph,
  options: GraphSummaryOptions = {}
): string {
  const { maxNodes, includeTags = true } = options
  const nodes = maxNodes ? graph.nodes.slice(0, maxNodes) : graph.nodes
  const lines: string[] = []

  lines.push(`# Vault Graph Summary (${graph.nodes.length} nodes, ${graph.edges.length} edges)`)
  lines.push('')

  // Nodes section
  lines.push('## Nodes')
  for (const node of nodes) {
    lines.push(formatNode(node))
  }

  if (maxNodes && graph.nodes.length > maxNodes) {
    lines.push(`... and ${graph.nodes.length - maxNodes} more nodes`)
  }

  lines.push('')

  // Edges section
  lines.push('## Edges')
  for (const edge of graph.edges) {
    lines.push(formatEdge(edge))
  }
  lines.push('')

  // Tag clusters
  if (includeTags) {
    const clusters = buildTagClusters(nodes)
    if (clusters.size > 0) {
      lines.push('## Tag Clusters')
      for (const [tag, ids] of [...clusters.entries()].sort((a, b) => b[1].length - a[1].length)) {
        lines.push(`${tag}: ${ids.join(', ')}`)
      }
      lines.push('')
    }
  }

  return lines.join('\n')
}

function formatNode(node: GraphNode): string {
  const tags = node.tags?.length ? ` tags:${node.tags.join(',')}` : ''
  return `- ${node.id} "${node.title}" [${node.type}]${tags} signal:${node.signal} (${node.connectionCount} edges)`
}

function formatEdge(edge: GraphEdge): string {
  return `${edge.source} --${edge.kind}--> ${edge.target}`
}

function buildTagClusters(nodes: readonly GraphNode[]): Map<string, string[]> {
  const clusters = new Map<string, string[]>()
  for (const node of nodes) {
    for (const tag of node.tags ?? []) {
      const existing = clusters.get(tag)
      if (existing) {
        existing.push(node.id)
      } else {
        clusters.set(tag, [node.id])
      }
    }
  }
  // Only include tags shared by 2+ nodes (single-node tags aren't useful for placement)
  const filtered = new Map<string, string[]>()
  for (const [tag, ids] of clusters) {
    if (ids.length >= 2) {
      filtered.set(tag, ids)
    }
  }
  return filtered
}
