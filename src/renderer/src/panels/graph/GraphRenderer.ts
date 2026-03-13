import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type Simulation
} from 'd3-force'
import type { GraphNode, RelationshipKind } from '@shared/types'
import { ARTIFACT_COLORS, colors, animations } from '../../design/tokens'
import { SIGNAL_OPACITY } from '@shared/types'
import { GlowSpriteCache, drawGlowSprite } from './glowSprites'
import type { HighlightState } from './useGraphHighlight'

// ---------------------------------------------------------------------------
// Animation utilities
// ---------------------------------------------------------------------------

let _prefersReducedMotion: boolean | null = null
export function prefersReducedMotion(): boolean {
  if (_prefersReducedMotion === null) {
    _prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
      _prefersReducedMotion = e.matches
    })
  }
  return _prefersReducedMotion
}

export function parseAnimationMs(timing: string): number {
  const match = timing.match(/^(\d+)ms/)
  return match ? parseInt(match[1], 10) : 0
}

export const ANIMATION_MS = {
  nodeHoverGlow: () =>
    prefersReducedMotion() ? 0 : parseAnimationMs(animations.graphNodeHoverGlow),
  networkReveal: () =>
    prefersReducedMotion() ? 0 : parseAnimationMs(animations.graphNetworkReveal),
  networkDim: () => (prefersReducedMotion() ? 0 : parseAnimationMs(animations.graphNetworkDim)),
  nodeEnter: () => (prefersReducedMotion() ? 0 : parseAnimationMs(animations.graphNodeEnter)),
  nodeExit: () => (prefersReducedMotion() ? 0 : parseAnimationMs(animations.graphNodeExit)),
  spatialTransition: () =>
    prefersReducedMotion() ? 0 : parseAnimationMs(animations.spatialTransition)
} as const

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

const EDGE_COLOR_MAP: Record<string, { color: string; width: number; dash: number[] }> = {
  connection: { color: colors.border.default, width: 1, dash: [] },
  cluster: { color: '#2DD4BF66', width: 1.5, dash: [] },
  tension: { color: '#EF444466', width: 1, dash: [4, 4] },
  appears_in: { color: '#3A3A3E', width: 1, dash: [] }
}

const LINK_STRENGTH: Record<RelationshipKind, number> = {
  connection: 0.3,
  cluster: 0.6,
  tension: -0.2,
  appears_in: 0.2
}

const HIGHLIGHT_EDGE_WIDTH = 1.5
const HIGHLIGHT_EDGE_ALPHA = 0.7
const DIM_ALPHA = 0.08
const HOVER_SHADOW_BLUR = 14
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
  skipAmbientSprites?: boolean
}

// ---------------------------------------------------------------------------
// Module-scoped glow sprite cache (shared across render calls)
// ---------------------------------------------------------------------------

const glowCache = new GlowSpriteCache()

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
  return forceSimulation<SimNode>(nodes)
    .force(
      'link',
      forceLink<SimNode, SimEdge>(edges)
        .id((d) => d.id)
        .strength((d) => Math.abs(LINK_STRENGTH[d.kind]) * config.linkForce)
        .distance(config.linkDistance)
    )
    .force('charge', forceManyBody<SimNode>().strength(config.repelForce))
    .force('center', forceCenter(width / 2, height / 2).strength(config.centerForce))
    .force(
      'collide',
      forceCollide<SimNode>().radius((d) => nodeRadius(d.connectionCount) + 4)
    )
}

// ---------------------------------------------------------------------------
// Node radius helpers
// ---------------------------------------------------------------------------

/**
 * Legacy alias: computes radius based on connection count using DEFAULT_SIZE_CONFIG.
 * Retained for backward compatibility with createSimulation and findNodeAt.
 */
export function nodeRadius(connectionCount: number): number {
  return Math.min(18, Math.max(6, 6 + connectionCount * 2))
}

/**
 * Compute node radius according to a NodeSizeConfig.
 */
export function computeNodeRadius(
  node: SimNode,
  config: NodeSizeConfig,
  charCount?: number
): number {
  switch (config.mode) {
    case 'uniform':
      return config.baseSize
    case 'content':
      return config.baseSize + Math.log(Math.max(charCount ?? 100, 100) / 100) * 2
    case 'degree':
    default:
      return config.baseSize + Math.sqrt(node.connectionCount) * 2.5
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
  // Stage 1: Clear + background
  const t0 = performance.now()
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = colors.bg.base
  ctx.fillRect(0, 0, width, height)

  // Stage 2: Compute highlight context
  const highlight = options?.highlight
  const highlightActive = highlight !== undefined && highlight.mode !== 'idle'
  const connectedSet: ReadonlySet<string> = highlight?.connectedSet ?? new Set()
  const focusedNodeId = highlight?.focusedNodeId ?? null
  const glowIntensity = highlight?.glowIntensity ?? 0

  // Size config
  const sizeConfig = options?.sizeConfig ?? DEFAULT_SIZE_CONFIG

  // Transform for culling (default: identity)
  const transform = options?.transform ?? { x: 0, y: 0, k: 1 }
  const canvasWidth = options?.canvasWidth ?? width
  const canvasHeight = options?.canvasHeight ?? height
  const textFadeThreshold = DEFAULT_RENDER_CONFIG.textFadeThreshold

  // Stage 3: Viewport culling bounds
  const cullBounds = computeCullBounds(canvasWidth, canvasHeight, transform)

  // Stage 4: Edge LOD - if very zoomed out, draw all edges in a single pass
  if (transform.k < 0.2) {
    ctx.globalAlpha = 0.06
    ctx.strokeStyle = colors.border.default
    ctx.lineWidth = 1
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
    ctx.globalAlpha = 1
  } else {
    // Stage 5: Draw individual edges
    for (const edge of edges) {
      const source = edge.source as SimNode
      const target = edge.target as SimNode
      if (!source.x || !target.x) continue

      // Cull if both endpoints are outside the viewport
      const sourceInView = isNodeInView(source, cullBounds)
      const targetInView = isNodeInView(target, cullBounds)
      if (!sourceInView && !targetInView) continue

      const kindKey = edge.kind as string
      const edgeStyle = EDGE_COLOR_MAP[kindKey] ?? EDGE_COLOR_MAP.connection

      ctx.beginPath()
      ctx.moveTo(source.x, source.y)
      ctx.lineTo(target.x, target.y)

      if (highlightActive) {
        const connected = isEdgeConnected(edge, connectedSet)
        if (connected) {
          ctx.strokeStyle = colors.accent.default
          ctx.lineWidth = HIGHLIGHT_EDGE_WIDTH
          ctx.globalAlpha = HIGHLIGHT_EDGE_ALPHA
          ctx.setLineDash([])
        } else {
          ctx.strokeStyle = edgeStyle.color
          ctx.lineWidth = edgeStyle.width
          ctx.globalAlpha = DIM_ALPHA
          ctx.setLineDash(edgeStyle.dash)
        }
      } else {
        ctx.strokeStyle = edgeStyle.color
        ctx.lineWidth = edgeStyle.width
        ctx.globalAlpha = 0.4
        ctx.setLineDash(edgeStyle.dash)
      }

      ctx.stroke()
      ctx.setLineDash([])
      ctx.globalAlpha = 1
    }
  }

  // Stage 6: Draw nodes
  const skipAmbientSprites = options?.skipAmbientSprites ?? false

  for (const node of nodes) {
    if (!node.x || !node.y) continue
    if (!isNodeInView(node, cullBounds)) continue

    const r = computeNodeRadius(node, sizeConfig)
    const color = ARTIFACT_COLORS[node.type] ?? ARTIFACT_COLORS.note
    const opacity = SIGNAL_OPACITY[node.signal] ?? 0.4
    const isSelected = node.id === selectedId
    const isHovered = node.id === hoveredId
    const isFocused = node.id === focusedNodeId
    const isConnected = connectedSet.has(node.id)
    const isDimmed = highlightActive && !isConnected

    if (transform.k < 0.4) {
      // Low detail: simple rectangle for performance
      ctx.globalAlpha = isDimmed ? DIM_ALPHA : opacity
      ctx.fillStyle = color
      ctx.fillRect(node.x - r / 2, node.y - r / 2, r, r)
      ctx.globalAlpha = 1
    } else {
      // Full detail rendering

      // Ambient glow sprite (skipped when dimmed or flag is set)
      if (!isDimmed && !skipAmbientSprites) {
        const sprite = glowCache.get(color, r)
        drawGlowSprite(ctx, sprite, node.x, node.y, opacity * glowIntensity * 0.5)
      }

      // Shadow effect for focused/hovered/connected nodes
      if (isFocused || isHovered || (isConnected && highlightActive)) {
        ctx.shadowColor = color
        ctx.shadowBlur = HOVER_SHADOW_BLUR
      }

      // Draw circle
      ctx.beginPath()
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.globalAlpha = isDimmed ? DIM_ALPHA : opacity
      ctx.fill()
      ctx.globalAlpha = 1

      // Selected: outer ring
      if (isSelected) {
        ctx.strokeStyle = colors.accent.default
        ctx.lineWidth = 2
        ctx.globalAlpha = SELECTED_RING_ALPHA
        ctx.beginPath()
        ctx.arc(node.x, node.y, r + SELECTED_RING_OFFSET, 0, Math.PI * 2)
        ctx.stroke()
        ctx.globalAlpha = 1
      }

      // Reset shadow
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
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
    ctx.fillStyle = colors.text.primary
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
    if (dx * dx + dy * dy < r * r) return node
  }
  return null
}
