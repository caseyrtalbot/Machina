import type { CanvasNode, CanvasEdge } from '@shared/canvas-types'
import { EDGE_PRIORITY, type ContextOptions, type ContextEdgeKind } from '@shared/context-types'

/** Estimate tokens from character count (~4 chars per token). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** Escape text for use inside ANSI-C quoted shell arguments ($'...').
 *  This handles newlines, single quotes, and backslashes correctly
 *  so the entire command stays on one line when written to a PTY. */
export function escapeForShell(text: string): string {
  // Only safe inside $'...' ANSI-C quoting. Do not use in other shell contexts.
  return text
    .replace(/\\/g, '\\\\') // backslashes first
    .replace(/'/g, "\\'") // single quotes
    .replace(/\n/g, '\\n') // newlines
    .replace(/\r/g, '\\r') // carriage returns
    .replace(new RegExp(String.fromCharCode(0), 'g'), '\\x00') // null bytes
}

/** Extract a human-readable title from a card. */
function cardTitle(node: CanvasNode): string {
  if (node.type === 'note' || node.type === 'text' || node.type === 'markdown') {
    const content = node.content
    // Vault note cards store file paths as content (renderer reads the file to display).
    // Detect paths: must be single-line AND start with / or drive letter.
    // Multi-line content starting with / is prose, not a path.
    if (!content.includes('\n') && (content.startsWith('/') || content.match(/^[A-Z]:\\/))) {
      const filename = content.split('/').pop() || content
      return filename.replace(/\.md$/, '').slice(0, 60) || `Untitled ${node.type}`
    }
    const firstLine = content.split('\n')[0] || ''
    return firstLine.replace(/^#+\s*/, '').slice(0, 60) || `Untitled ${node.type}`
  }
  if (node.type === 'code') {
    const meta = node.metadata as Record<string, unknown>
    return `${meta.filename || meta.language || 'code'}`
  }
  if (node.type === 'file-view') {
    const meta = node.metadata as Record<string, unknown>
    return `File: ${meta.language || 'unknown'}`
  }
  if (node.type === 'terminal') return 'Terminal'
  if (node.type === 'image') return 'Image'
  if (node.type === 'pdf') return 'PDF document'
  if (node.type === 'project-file') {
    const meta = node.metadata as Record<string, unknown>
    return `${meta.relativePath || 'project file'}`
  }
  if (node.type === 'system-artifact') {
    const meta = node.metadata as Record<string, unknown>
    return `${meta.artifactKind || 'artifact'}`
  }
  return node.type
}

/** Extract a content snippet for connected cards.
 *  ~200 chars for note/text/markdown, ~60 chars for code/file-view. */
function contentSnippet(node: CanvasNode): string {
  if (!node.content) return ''
  const clean = node.content
    .replace(/^#+\s*/gm, '')
    .replace(/\n+/g, ' ')
    .trim()
  // Richer snippets for content-heavy cards (Cherry-pick 1)
  const limit = node.type === 'note' || node.type === 'text' || node.type === 'markdown' ? 200 : 60
  return clean.length > limit ? clean.slice(0, limit - 3) + '...' : clean
}

/** Get priority index for an edge kind (lower = higher priority). */
function edgePriority(kind: string, priorities: readonly ContextEdgeKind[]): number {
  const idx = (priorities as readonly string[]).indexOf(kind)
  return idx === -1 ? priorities.length : idx
}

/** Edge type legend for Claude orientation. */
const EDGE_LEGEND = `Cards are connected by typed edges:
- causal: strong cause-effect relationship (highest priority)
- tension: productive contradiction between ideas
- connection: neutral relatedness
- cluster: mutual reinforcement
- related: Obsidian-native link
- co-occurrence: inferred from shared concepts`

/**
 * Serialize the canvas neighborhood of a card into a natural-language
 * context document for injection into Claude's system prompt.
 *
 * Design principles (from research):
 * 1. Incident encoding: list each card with its relationship
 * 2. Two-tier detail: focused header + connected cards (peripheral dropped)
 * 3. Edge-type prioritization: causal > tension > connection > ...
 * 4. Token budget cap (default ~500 tokens)
 * 5. Min 1 connected card guaranteed after pruning
 */
/** Result from serialization, including metadata for UI truthfulness. */
export interface SerializeResult {
  readonly text: string
  readonly cardCount: number
  readonly wasTruncated: boolean
}

export function serializeNeighborhood(
  cardId: string,
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  options?: ContextOptions
): string {
  const maxTokens = options?.maxTokens ?? 500
  const priorities = options?.edgePriorityOverride ?? EDGE_PRIORITY

  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const focusedNode = nodeMap.get(cardId)
  if (!focusedNode) return ''

  // --- Collect ALL edges touching this card (both directions), sorted by priority ---
  const relevantEdges = edges
    .filter((e) => e.fromNode === cardId || e.toNode === cardId)
    .sort((a, b) => {
      const kindA = (a.kind ?? 'connection') as string
      const kindB = (b.kind ?? 'connection') as string
      return edgePriority(kindA, priorities) - edgePriority(kindB, priorities)
    })

  // --- Build connected cards list (Decision 8A: show ALL edges, no dedup by neighbor) ---
  // Group edges by neighbor for compact output
  const neighborEdges = new Map<
    string,
    { node: CanvasNode; edges: Array<{ kind: string; label?: string }> }
  >()

  for (const edge of relevantEdges) {
    const neighborId = edge.fromNode === cardId ? edge.toNode : edge.fromNode
    const neighbor = nodeMap.get(neighborId)
    if (!neighbor) continue

    const kind = (edge.kind ?? 'connection') as string
    const existing = neighborEdges.get(neighborId)
    if (existing) {
      existing.edges.push({ kind, label: edge.label })
    } else {
      neighborEdges.set(neighborId, {
        node: neighbor,
        edges: [{ kind, label: edge.label }]
      })
    }
  }

  // --- Build output ---
  const lines: string[] = []

  // Header with skill orientation (Task 7)
  lines.push(`You are running inside a canvas card (${focusedNode.type}) in Thought Engine.`)
  lines.push('The canvas is a spatial workspace where cards represent knowledge artifacts.')
  if (options?.contextFilePath) {
    lines.push(
      `Canvas context is kept up to date at: ${options.contextFilePath}`,
      'Read this file to see the current canvas state when cards change around you.'
    )
  }

  if (neighborEdges.size > 0) {
    lines.push(EDGE_LEGEND)
    lines.push('')
    lines.push('Connected cards on this canvas:')

    for (const [, { node: neighbor, edges: edgeList }] of neighborEdges) {
      const title = cardTitle(neighbor)
      const snippet = contentSnippet(neighbor)

      // Format edge relationships
      const relations = edgeList.map((e) => (e.label ? `${e.kind} (${e.label})` : e.kind))
      const relationStr = relations.join(', ')
      const snippetStr = snippet ? ` — "${snippet}"` : ''
      lines.push(`- ${title} [${neighbor.type}] via ${relationStr}${snippetStr}`)
    }
    lines.push('')
  }

  // --- List all other cards on the canvas (not connected by edges) ---
  // Every card on the canvas is intentionally placed. List them so Claude
  // has full awareness even without edges (solves chicken-and-egg at launch).
  const connectedIds = new Set(neighborEdges.keys())
  const otherCards = nodes.filter(
    (n) => n.id !== cardId && !connectedIds.has(n.id) && n.type !== 'terminal'
  )
  if (otherCards.length > 0) {
    lines.push('Other cards on this canvas:')
    for (const card of otherCards) {
      const title = cardTitle(card)
      lines.push(`- ${title} [${card.type}]`)
    }
    lines.push('')
  }

  let result = lines.join('\n')

  // Enforce token budget: trim other cards first, then connected entries
  // But always keep at least 1 connected card if any exist (Decision T2)
  while (estimateTokens(result) > maxTokens && result.includes('Other cards')) {
    const otherIdx = result.indexOf('Other cards')
    result = result.slice(0, otherIdx).trimEnd() + '\n'
  }
  let connectedCount = neighborEdges.size
  while (estimateTokens(result) > maxTokens && connectedCount > 1) {
    const lastDash = result.lastIndexOf('\n-')
    if (lastDash <= 0) break
    result = result.slice(0, lastDash).trimEnd() + '\n'
    connectedCount--
  }

  return result.trimEnd()
}

/**
 * Structured wrapper around serializeNeighborhood that returns metadata
 * so the UI can honestly report what Claude actually received (card count,
 * whether token budget forced truncation).
 */
export function serializeNeighborhoodStructured(
  cardId: string,
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  options?: ContextOptions
): SerializeResult {
  const totalCards = nodes.filter((n) => n.id !== cardId && n.type !== 'terminal').length

  const text = serializeNeighborhood(cardId, nodes, edges, options)

  // Count cards that appear in the serialized output (lines starting with "- " containing "[type]")
  const cardLinesInOutput = text
    .split('\n')
    .filter((l) => l.startsWith('- ') && l.includes('[')).length

  return {
    text,
    cardCount: cardLinesInOutput,
    wasTruncated: cardLinesInOutput < totalCards
  }
}

/**
 * Ultra-compact single-line format for injecting context updates into a live
 * Claude PTY session. No newlines, no escaping, no edge legends.
 *
 * Output: "[Canvas: Osho (connection), Richard Feynman, Will Durant]"
 */
export function serializeCompact(
  cardId: string,
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[]
): string {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  if (!nodeMap.has(cardId)) return ''

  const parts: string[] = []
  const connectedIds = new Set<string>()

  // Connected cards first (with edge kind)
  const relevantEdges = edges.filter((e) => e.fromNode === cardId || e.toNode === cardId)
  for (const edge of relevantEdges) {
    const neighborId = edge.fromNode === cardId ? edge.toNode : edge.fromNode
    if (connectedIds.has(neighborId)) continue
    connectedIds.add(neighborId)
    const neighbor = nodeMap.get(neighborId)
    if (!neighbor) continue
    const kind = (edge.kind ?? 'connection') as string
    parts.push(`${cardTitle(neighbor)} (${kind})`)
  }

  // Other non-terminal cards
  for (const n of nodes) {
    if (n.id === cardId || connectedIds.has(n.id) || n.type === 'terminal') continue
    parts.push(cardTitle(n))
  }

  if (parts.length === 0) return ''
  return `[Canvas: ${parts.join(', ')}]`
}
