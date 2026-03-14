import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type Simulation
} from 'd3-force'
import type { GraphNode, RelationshipKind } from '@shared/types'
import { getArtifactColor, getComputedCssColor } from '../../design/tokens'
import { SIGNAL_OPACITY } from '@shared/types'
// Glow sprites available but not used in hot path for performance
// import { GlowSpriteCache, drawGlowSprite } from './glowSprites'
import type { HighlightState } from './useGraphHighlight'

export type { NodeSizeMode } from '../../store/graph-settings-store'

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export interface SimNode extends GraphNode {
  x: number
  y: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
}

export interface SimEdge {
  source: string | SimNode
  target: string | SimNode
  kind: RelationshipKind
}

export interface SimulationConfig {
  centerForce: number
  repelForce: number
  linkForce: number
  linkDistance: number
}

export interface RenderConfig {
  baseNodeSize: number
  linkOpacity: number
  linkThickness: number
  showArrows: boolean
  textFadeThreshold: number
  zoomLevel: number
  groupColors: Record<string, string>
}

export interface NodeSizeConfig {
  mode: 'degree' | 'uniform' | 'content'
  baseSize: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SIM_CONFIG: SimulationConfig = {
  centerForce: 0.5,
  repelForce: -120,
  linkForce: 0.3,
  linkDistance: 30
}

const DEFAULT_RENDER_CONFIG: RenderConfig = {
  baseNodeSize: 4,
  linkOpacity: 0.4,
  linkThickness: 1,
  showArrows: false,
  textFadeThreshold: 1.5,
  zoomLevel: 1,
  groupColors: {}
}

const DEFAULT_SIZE_CONFIG: NodeSizeConfig = { mode: 'degree', baseSize: 4 }

// Batched rendering uses a single edge color for performance.
// Per-kind styling available for future use if needed.
const EDGE_COLOR = '#475569'

const LINK_STRENGTH: Record<RelationshipKind, number> = {
  connection: 0.3,
  cluster: 0.6,
  tension: -0.2,
  appears_in: 0.2,
  wikilink: 0.15,
  tag: 0.1
}

const HIGHLIGHT_EDGE_WIDTH = 1.5
const HIGHLIGHT_EDGE_ALPHA = 0.7
const DIM_ALPHA = 0.08
const HOVER_SHADOW_BLUR = 8
const LABEL_FONT = '12px Inter, sans-serif'
const SELECTED_RING_OFFSET = 4
const SELECTED_RING_ALPHA = 0.4
const CULL_MARGIN = 40

interface RenderOptions {
  highlight: HighlightState
  sizeConfig: NodeSizeConfig
  transform: { x: number; y: number; k: number }
  canvasWidth: number
  canvasHeight: number
  reducedMotion: boolean
  /** @deprecated no longer used — kept for interface compatibility */
  skipAmbientSprites?: boolean
  linkOpacity?: number
  linkThickness?: number
  textFadeThreshold?: number
  showArrows?: boolean
}

// ---------------------------------------------------------------------------
// Module-scoped glow sprite cache (shared across render calls)
// ---------------------------------------------------------------------------

// const glowCache = new GlowSpriteCache()

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

export function createSimulation(
  nodes: SimNode[],
  edges: SimEdge[],
  width: number,
  height: number,
  config: SimulationConfig = DEFAULT_SIM_CONFIG
): Simulation<SimNode, SimEdge> {
  // Scale physics for graph size: larger graphs need faster settling + weaker forces
  const n = nodes.length
  const isLarge = n > 200
  const alphaDecay = isLarge ? 0.04 : 0.0228 // default is ~0.0228; larger = settles faster
  const velocityDecay = isLarge ? 0.5 : 0.4 // higher = more friction

  const charge = forceManyBody<SimNode>().strength(config.repelForce)
  // Barnes-Hut theta: higher = faster approximation for O(n log n) instead of O(n²)
  if (isLarge) charge.theta(1.2)

  return forceSimulation<SimNode>(nodes)
    .alphaMin(isLarge ? 0.01 : 0.001) // stop sooner for large graphs
    .alphaDecay(alphaDecay)
    .velocityDecay(velocityDecay)
    .force(
      'link',
      forceLink<SimNode, SimEdge>(edges)
        .id((d) => d.id)
        .strength((d) => Math.abs(LINK_STRENGTH[d.kind]) * config.linkForce)
        .distance(config.linkDistance)
    )
    .force('charge', charge)
    .force('center', forceCenter(width / 2, height / 2).strength(config.centerForce))
    .force(
      'collide',
      forceCollide<SimNode>().radius((d) => nodeRadius(d.connectionCount) + 4)
    )
}

// ---------------------------------------------------------------------------
// Node radius helpers
// ---------------------------------------------------------------------------

/** Computes radius based on connection count (used by simulation collision + findNodeAt). */
function nodeRadius(connectionCount: number): number {
  return Math.min(18, Math.max(6, 6 + connectionCount * 2))
}

/** Compute node radius according to a NodeSizeConfig. */
function computeNodeRadius(node: SimNode, config: NodeSizeConfig, charCount?: number): number {
  switch (config.mode) {
    case 'uniform':
      return config.baseSize
    case 'content':
      return config.baseSize + Math.log(Math.max(charCount ?? 100, 100) / 100) * 2
    case 'degree':
    default:
      return config.baseSize + Math.sqrt(node.connectionCount) * 1.5
  }
}

// ---------------------------------------------------------------------------
// Viewport culling
// ---------------------------------------------------------------------------

interface CullBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function computeCullBounds(
  canvasWidth: number,
  canvasHeight: number,
  transform: { x: number; y: number; k: number }
): CullBounds {
  const { x, y, k } = transform
  // Convert canvas corners to graph-space, then expand by CULL_MARGIN
  const minX = -x / k - CULL_MARGIN
  const minY = -y / k - CULL_MARGIN
  const maxX = (canvasWidth - x) / k + CULL_MARGIN
  const maxY = (canvasHeight - y) / k + CULL_MARGIN
  return { minX, minY, maxX, maxY }
}

function isNodeInView(node: SimNode, bounds: CullBounds): boolean {
  return (
    node.x >= bounds.minX && node.x <= bounds.maxX && node.y >= bounds.minY && node.y <= bounds.maxY
  )
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function getEdgeNodeId(endpoint: string | SimNode): string {
  return typeof endpoint === 'string' ? endpoint : endpoint.id
}

function isEdgeConnected(edge: SimEdge, connectedSet: ReadonlySet<string>): boolean {
  const sourceId = getEdgeNodeId(edge.source)
  const targetId = getEdgeNodeId(edge.target)
  return connectedSet.has(sourceId) && connectedSet.has(targetId)
}

// ---------------------------------------------------------------------------
// Main render function
// ---------------------------------------------------------------------------

/**
 * Render the graph to a canvas context.
 *
 * Returns the frame duration in milliseconds so callers can monitor budget.
 * Backward compatible: all parameters after hoveredId are optional.
 */
export function renderGraph(
  ctx: CanvasRenderingContext2D,
  nodes: readonly SimNode[],
  edges: readonly SimEdge[],
  width: number,
  height: number,
  selectedId: string | null,
  hoveredId: string | null,
  options?: RenderOptions
): number {
  // Resolve theme colors once per frame (canvas 2D needs raw values, not CSS vars)
  const themeAccent = getComputedCssColor('--color-accent-default') || '#00e5bf'
  const themeText = getComputedCssColor('--color-text-primary') || '#e2e8f0'

  // Stage 1: timing start (caller handles canvas clear + background fill)
  const t0 = performance.now()

  // Stage 2: Compute highlight context
  const highlight = options?.highlight
  const highlightActive = highlight !== undefined && highlight.mode !== 'idle'
  const connectedSet: ReadonlySet<string> = highlight?.connectedSet ?? new Set()
  const focusedNodeId = highlight?.focusedNodeId ?? null
  // Size config
  const sizeConfig = options?.sizeConfig ?? DEFAULT_SIZE_CONFIG

  // Transform for culling (default: identity)
  const transform = options?.transform ?? { x: 0, y: 0, k: 1 }
  const canvasWidth = options?.canvasWidth ?? width
  const canvasHeight = options?.canvasHeight ?? height
  const textFadeThreshold = options?.textFadeThreshold ?? DEFAULT_RENDER_CONFIG.textFadeThreshold
  const linkOpacity = options?.linkOpacity ?? DEFAULT_RENDER_CONFIG.linkOpacity
  const linkThickness = options?.linkThickness ?? DEFAULT_RENDER_CONFIG.linkThickness

  // Stage 3: Viewport culling bounds
  const cullBounds = computeCullBounds(canvasWidth, canvasHeight, transform)

  // ---------------------------------------------------------------------------
  // Stage 4: BATCHED edge rendering (single draw call for all normal edges)
  // ---------------------------------------------------------------------------
  // Obsidian-style: one batch path for all non-highlighted edges, then a small
  // separate pass for highlighted edges only. This avoids per-edge state changes.
  // ---------------------------------------------------------------------------

  if (highlightActive) {
    // Dimmed edges: single batch
    ctx.globalAlpha = DIM_ALPHA
    ctx.strokeStyle = EDGE_COLOR
    ctx.lineWidth = 0.5 * linkThickness
    ctx.setLineDash([])
    ctx.beginPath()
    for (const edge of edges) {
      const source = edge.source as SimNode
      const target = edge.target as SimNode
      if (!source.x || !target.x) continue
      if (isEdgeConnected(edge, connectedSet)) continue // skip highlighted
      ctx.moveTo(source.x, source.y)
      ctx.lineTo(target.x, target.y)
    }
    ctx.stroke()

    // Highlighted edges: separate batch
    ctx.globalAlpha = HIGHLIGHT_EDGE_ALPHA
    ctx.strokeStyle = themeAccent
    ctx.lineWidth = HIGHLIGHT_EDGE_WIDTH * linkThickness
    ctx.beginPath()
    for (const edge of edges) {
      const source = edge.source as SimNode
      const target = edge.target as SimNode
      if (!source.x || !target.x) continue
      if (!isEdgeConnected(edge, connectedSet)) continue
      ctx.moveTo(source.x, source.y)
      ctx.lineTo(target.x, target.y)
    }
    ctx.stroke()
  } else {
    // Normal mode: ALL edges in one single batch path
    ctx.globalAlpha = linkOpacity
    ctx.strokeStyle = EDGE_COLOR
    ctx.lineWidth = 0.5 * linkThickness
    ctx.setLineDash([])
    ctx.beginPath()
    for (const edge of edges) {
      const source = edge.source as SimNode
      const target = edge.target as SimNode
      if (!source.x || !target.x) continue
      ctx.moveTo(source.x, source.y)
      ctx.lineTo(target.x, target.y)
    }
    ctx.stroke()
  }
  ctx.setLineDash([])
  ctx.globalAlpha = 1

  // ---------------------------------------------------------------------------
  // Stage 5: BATCHED node rendering (group by color to minimize state changes)
  // ---------------------------------------------------------------------------

  // Collect visible nodes with precomputed values
  const visibleNodes: Array<{
    node: SimNode
    r: number
    color: string
    opacity: number
    isDimmed: boolean
  }> = []

  for (const node of nodes) {
    if (!node.x || !node.y) continue
    if (!isNodeInView(node, cullBounds)) continue
    const isConnected = connectedSet.has(node.id)
    const isDimmed = highlightActive && !isConnected
    visibleNodes.push({
      node,
      r: computeNodeRadius(node, sizeConfig),
      color: getArtifactColor(node.type),
      opacity: SIGNAL_OPACITY[node.signal] ?? 0.65,
      isDimmed
    })
  }

  // Group by color for batched fills
  const colorGroups = new Map<string, typeof visibleNodes>()
  for (const entry of visibleNodes) {
    const key = entry.isDimmed ? `dim:${entry.color}` : entry.color
    const group = colorGroups.get(key)
    if (group) {
      group.push(entry)
    } else {
      colorGroups.set(key, [entry])
    }
  }

  // Draw all nodes in batched color groups
  for (const [key, group] of colorGroups) {
    const isDimGroup = key.startsWith('dim:')
    const color = isDimGroup ? key.slice(4) : key
    ctx.fillStyle = color
    ctx.globalAlpha = isDimGroup ? DIM_ALPHA : group[0].opacity

    for (const { node, r } of group) {
      if (node.type === 'tag') {
        ctx.beginPath()
        ctx.moveTo(node.x, node.y - r)
        ctx.lineTo(node.x + r, node.y)
        ctx.lineTo(node.x, node.y + r)
        ctx.lineTo(node.x - r, node.y)
        ctx.closePath()
        ctx.fill()
      } else {
        ctx.beginPath()
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
  ctx.globalAlpha = 1

  // Hovered node: subtle glow (only 1 node, fine to use shadow)
  if (hoveredId || focusedNodeId) {
    const targetId = focusedNodeId ?? hoveredId
    const entry = visibleNodes.find((e) => e.node.id === targetId)
    if (entry) {
      ctx.shadowColor = entry.color
      ctx.shadowBlur = HOVER_SHADOW_BLUR
      ctx.fillStyle = entry.color
      ctx.globalAlpha = entry.opacity
      ctx.beginPath()
      ctx.arc(entry.node.x, entry.node.y, entry.r, 0, Math.PI * 2)
      ctx.fill()
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
      ctx.globalAlpha = 1
    }
  }

  // Selected node: accent ring
  if (selectedId) {
    const entry = visibleNodes.find((e) => e.node.id === selectedId)
    if (entry) {
      ctx.strokeStyle = themeAccent
      ctx.lineWidth = 2
      ctx.globalAlpha = SELECTED_RING_ALPHA
      ctx.beginPath()
      ctx.arc(entry.node.x, entry.node.y, entry.r + SELECTED_RING_OFFSET, 0, Math.PI * 2)
      ctx.stroke()
      ctx.globalAlpha = 1
    }
  }

  // Stage 7: Labels
  ctx.font = LABEL_FONT
  ctx.textAlign = 'center'

  for (const node of nodes) {
    if (!node.x || !node.y) continue
    if (!isNodeInView(node, cullBounds)) continue

    const isFocused = node.id === focusedNodeId
    const isHovered = node.id === hoveredId
    const isConnected = connectedSet.has(node.id)
    const showLabel =
      isFocused ||
      isHovered ||
      (isConnected && highlightActive && transform.k >= textFadeThreshold) ||
      transform.k >= textFadeThreshold

    if (!showLabel) continue

    const r = computeNodeRadius(node, sizeConfig)

    let labelAlpha = 1
    if (!isFocused && !isHovered) {
      const fadeRange = 0.5
      const excess = transform.k - textFadeThreshold
      labelAlpha = Math.min(1, Math.max(0, excess / fadeRange))
    }

    ctx.globalAlpha = labelAlpha
    ctx.fillStyle = themeText
    ctx.fillText(node.title, node.x, node.y - r - 6)
    ctx.globalAlpha = 1
  }

  // Stage 8: Frame budget
  const duration = performance.now() - t0
  if (duration > 16) {
    console.warn(`[GraphRenderer] frame budget exceeded: ${duration.toFixed(2)}ms`)
  }

  return duration
}

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

export function findNodeAt(nodes: SimNode[], x: number, y: number): SimNode | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]
    const r = nodeRadius(node.connectionCount)
    const dx = x - (node.x || 0)
    const dy = y - (node.y || 0)
    if (node.type === 'tag') {
      // Diamond hit-test: point is inside if |dx|/r + |dy|/r <= 1
      if (Math.abs(dx) / r + Math.abs(dy) / r <= 1) return node
    } else {
      if (dx * dx + dy * dy < r * r) return node
    }
  }
  return null
}
