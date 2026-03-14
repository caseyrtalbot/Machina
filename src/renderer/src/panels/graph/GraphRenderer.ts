import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type Simulation
} from 'd3-force'
import { quadtree, type Quadtree } from 'd3-quadtree'
import {
  GRAPH_PALETTE,
  LINK_STRENGTH,
  LARGE_GRAPH_THRESHOLD,
  DEFAULT_SIM_CONFIG,
  CULL_MARGIN,
  LABEL_OFFSET_BELOW,
  ARROW_SIZE,
  BOKEH_RADIUS_SCALE,
  BOKEH_FILL_ALPHA,
  BOKEH_SHADOW_BLUR,
  NEIGHBOR_SHADOW_BLUR,
  FOCAL_SHADOW_BLUR
} from './graph-config'
import type { SimNode, SimEdge, SimulationConfig, RenderOptions } from './graph-config'

// ---------------------------------------------------------------------------
// Render constants (file-local, not extracted)
// ---------------------------------------------------------------------------

const LABEL_FONT = '11px Inter, system-ui, sans-serif'
const SELECTED_RING_WIDTH = 2
const BOKEH_SHADOW_ALPHA = 0.04

// ---------------------------------------------------------------------------
// Backwards-compatible re-exports (consumers will be updated in a later task)
// ---------------------------------------------------------------------------

export type { SimNode, SimEdge, SimulationConfig, RenderOptions }
export { GRAPH_PALETTE }

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
  const n = nodes.length
  const isLarge = n > LARGE_GRAPH_THRESHOLD
  const alphaDecay = isLarge ? 0.04 : 0.02
  const velocityDecay = isLarge ? 0.5 : 0.4

  const charge = forceManyBody<SimNode>().strength(config.repelForce)
  if (isLarge) charge.theta(1.2)

  return forceSimulation<SimNode>(nodes)
    .alphaMin(isLarge ? 0.01 : 0.001)
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
      forceCollide<SimNode>().radius((d) => computeNodeRadius(d) + 4)
    )
}

// ---------------------------------------------------------------------------
// Node radius: sqrt(inbound links), min 3px, max 16px
// Tag nodes are 0.7× the note size
// ---------------------------------------------------------------------------

function computeNodeRadius(node: SimNode, multiplier: number = 1): number {
  const base = Math.min(16, Math.max(3, Math.sqrt(Math.max(1, node.connectionCount)) * 3))
  const typeScale = node.type === 'tag' ? 0.7 : 1
  return base * typeScale * multiplier
}

// ---------------------------------------------------------------------------
// Node color: resolved from _color (group rule) or defaults
// ---------------------------------------------------------------------------

function getNodeColor(node: SimNode): string {
  if (node._color) return node._color
  if (node.type === 'tag') return GRAPH_PALETTE.defaultTag
  if (node.type === 'attachment') return GRAPH_PALETTE.defaultAttach
  return GRAPH_PALETTE.defaultNote
}

// ---------------------------------------------------------------------------
// Color utilities
// ---------------------------------------------------------------------------

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function lightenHex(hex: string, factor: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const lr = Math.min(255, Math.round(r + (255 - r) * factor))
  const lg = Math.min(255, Math.round(g + (255 - g) * factor))
  const lb = Math.min(255, Math.round(b + (255 - b) * factor))
  return `#${lr.toString(16).padStart(2, '0')}${lg.toString(16).padStart(2, '0')}${lb.toString(16).padStart(2, '0')}`
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
  return {
    minX: -x / k - CULL_MARGIN,
    minY: -y / k - CULL_MARGIN,
    maxX: (canvasWidth - x) / k + CULL_MARGIN,
    maxY: (canvasHeight - y) / k + CULL_MARGIN
  }
}

function isNodeInView(node: SimNode, bounds: CullBounds): boolean {
  return (
    node.x >= bounds.minX && node.x <= bounds.maxX && node.y >= bounds.minY && node.y <= bounds.maxY
  )
}

// ---------------------------------------------------------------------------
// Edge helpers
// ---------------------------------------------------------------------------

function getEdgeNodeId(endpoint: string | SimNode): string {
  return typeof endpoint === 'string' ? endpoint : endpoint.id
}

function isEdgeConnected(edge: SimEdge, connectedSet: ReadonlySet<string>): boolean {
  return (
    connectedSet.has(getEdgeNodeId(edge.source)) && connectedSet.has(getEdgeNodeId(edge.target))
  )
}

// ---------------------------------------------------------------------------
// Vignette (screen-space post-effect)
// ---------------------------------------------------------------------------

export function renderVignette(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const cx = w / 2
  const cy = h / 2
  const radius = Math.sqrt(cx * cx + cy * cy)
  const gradient = ctx.createRadialGradient(cx, cy, radius * 0.4, cx, cy, radius)
  gradient.addColorStop(0, 'transparent')
  gradient.addColorStop(1, GRAPH_PALETTE.vignetteEdge)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, w, h)
}

// ---------------------------------------------------------------------------
// Node shape drawing
// ---------------------------------------------------------------------------

function drawNoteNode(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
}

function drawTagNode(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x, y - r)
  ctx.lineTo(x + r, y)
  ctx.lineTo(x, y + r)
  ctx.lineTo(x - r, y)
  ctx.closePath()
}

function drawAttachmentNode(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  const cornerRadius = 2
  const size = r * 2
  const left = x - r
  const top = y - r
  ctx.beginPath()
  ctx.roundRect(left, top, size, size, cornerRadius)
}

function drawNodeShape(
  ctx: CanvasRenderingContext2D,
  node: SimNode,
  x: number,
  y: number,
  r: number
): void {
  if (node.type === 'tag') {
    drawTagNode(ctx, x, y, r)
  } else if (node.type === 'attachment') {
    drawAttachmentNode(ctx, x, y, r)
  } else {
    drawNoteNode(ctx, x, y, r)
  }
}

// ---------------------------------------------------------------------------
// Arrowhead
// ---------------------------------------------------------------------------

function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  targetRadius: number
): void {
  const dx = tx - sx
  const dy = ty - sy
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len === 0) return

  const ux = dx / len
  const uy = dy / len
  const tipX = tx - ux * targetRadius
  const tipY = ty - uy * targetRadius

  ctx.beginPath()
  ctx.moveTo(tipX, tipY)
  ctx.lineTo(
    tipX - ux * ARROW_SIZE + uy * ARROW_SIZE * 0.4,
    tipY - uy * ARROW_SIZE - ux * ARROW_SIZE * 0.4
  )
  ctx.lineTo(
    tipX - ux * ARROW_SIZE - uy * ARROW_SIZE * 0.4,
    tipY - uy * ARROW_SIZE + ux * ARROW_SIZE * 0.4
  )
  ctx.closePath()
  ctx.fill()
}

// ---------------------------------------------------------------------------
// Main render function
// ---------------------------------------------------------------------------

export function renderGraph(
  ctx: CanvasRenderingContext2D,
  nodes: readonly SimNode[],
  edges: readonly SimEdge[],
  _width: number,
  _height: number,
  selectedId: string | null,
  hoveredId: string | null,
  options: RenderOptions
): number {
  const t0 = performance.now()

  const highlight = options.highlight
  const highlightActive = highlight.mode !== 'idle'
  const connectedSet = highlight.connectedSet
  const focusedNodeId = highlight.focusedNodeId
  const transform = options.transform
  const canvasWidth = options.canvasWidth
  const canvasHeight = options.canvasHeight
  const multiplier = options.nodeSizeMultiplier
  const linkThickness = options.linkThickness
  const textFadeThreshold = options.textFadeThreshold
  const showArrows = options.showArrows
  const searchQuery = options.searchQuery.toLowerCase()

  const cullBounds = computeCullBounds(canvasWidth, canvasHeight, transform)

  // -----------------------------------------------------------------------
  // Stage 1: EDGES
  // -----------------------------------------------------------------------

  if (highlightActive) {
    // All non-highlighted edges: invisible
    // (spec: "all other links: invisible (alpha 0)")

    // Highlighted edges: teal
    ctx.globalAlpha = 0.7
    ctx.strokeStyle = GRAPH_PALETTE.linkActive
    ctx.lineWidth = 1.5 * linkThickness
    ctx.setLineDash([])
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

    // Arrowheads for highlighted edges
    if (showArrows) {
      ctx.fillStyle = GRAPH_PALETTE.linkActive
      for (const edge of edges) {
        const source = edge.source as SimNode
        const target = edge.target as SimNode
        if (!source.x || !target.x) continue
        if (!isEdgeConnected(edge, connectedSet)) continue
        const tr = computeNodeRadius(target, multiplier)
        drawArrowhead(ctx, source.x, source.y, target.x, target.y, tr)
      }
    }
  } else {
    // Normal mode: gossamer threads
    ctx.globalAlpha = 0.04
    ctx.strokeStyle = '#ffffff'
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

    // Arrowheads for normal mode
    if (showArrows) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.04)'
      for (const edge of edges) {
        const source = edge.source as SimNode
        const target = edge.target as SimNode
        if (!source.x || !target.x) continue
        const tr = computeNodeRadius(target, multiplier)
        drawArrowhead(ctx, source.x, source.y, target.x, target.y, tr)
      }
    }
  }
  ctx.setLineDash([])
  ctx.globalAlpha = 1

  // -----------------------------------------------------------------------
  // Stage 2: Classify visible nodes
  // -----------------------------------------------------------------------

  interface VisibleNode {
    node: SimNode
    r: number
    color: string
    isFocal: boolean
    isNeighbor: boolean
    isDimmed: boolean
    matchesSearch: boolean
  }

  const visibleNodes: VisibleNode[] = []

  for (const node of nodes) {
    if (!node.x || !node.y) continue
    if (!isNodeInView(node, cullBounds)) continue

    const isFocal = node.id === focusedNodeId
    const isNeighbor = !isFocal && connectedSet.has(node.id)
    const isDimmed = highlightActive && !isFocal && !isNeighbor
    const matchesSearch = !searchQuery || node.title.toLowerCase().includes(searchQuery)
    const r = computeNodeRadius(node, multiplier)
    const color = getNodeColor(node)

    visibleNodes.push({ node, r, color, isFocal, isNeighbor, isDimmed, matchesSearch })
  }

  // -----------------------------------------------------------------------
  // Stage 3: BOKEH pass — dimmed/defocused nodes
  // -----------------------------------------------------------------------

  if (highlightActive) {
    // Group bokeh nodes by color to minimize state changes
    const bokehByColor = new Map<string, VisibleNode[]>()
    for (const vn of visibleNodes) {
      if (!vn.isDimmed) continue
      const group = bokehByColor.get(vn.color)
      if (group) group.push(vn)
      else bokehByColor.set(vn.color, [vn])
    }

    for (const [color, group] of bokehByColor) {
      ctx.fillStyle = hexToRgba(color, BOKEH_FILL_ALPHA)
      ctx.shadowColor = hexToRgba(color, BOKEH_SHADOW_ALPHA)
      ctx.shadowBlur = BOKEH_SHADOW_BLUR
      ctx.strokeStyle = 'transparent'

      for (const vn of group) {
        // Bokeh: always circles, radius × 1.5, no stroke, no label
        ctx.beginPath()
        ctx.arc(vn.node.x, vn.node.y, vn.r * BOKEH_RADIUS_SCALE, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
  }

  // -----------------------------------------------------------------------
  // Stage 4: BRIGHT pass — focal + neighbor nodes
  // -----------------------------------------------------------------------

  // Group bright nodes by color for batched fills
  const brightByColor = new Map<string, VisibleNode[]>()
  for (const vn of visibleNodes) {
    if (vn.isDimmed) continue
    const group = brightByColor.get(vn.color)
    if (group) group.push(vn)
    else brightByColor.set(vn.color, [vn])
  }

  for (const [color, group] of brightByColor) {
    ctx.fillStyle = color
    ctx.strokeStyle = lightenHex(color, 0.2)
    ctx.lineWidth = 1
    ctx.globalAlpha = 1

    // Search dimming: nodes not matching search get reduced opacity
    for (const vn of group) {
      ctx.globalAlpha = vn.matchesSearch ? 1 : 0.15
      drawNodeShape(ctx, vn.node, vn.node.x, vn.node.y, vn.r)
      ctx.fill()
      ctx.stroke()
    }
  }
  ctx.globalAlpha = 1

  // Neighbor glow (subtle)
  if (highlightActive) {
    for (const vn of visibleNodes) {
      if (!vn.isNeighbor) continue
      ctx.shadowColor = hexToRgba(vn.color, 0.6)
      ctx.shadowBlur = NEIGHBOR_SHADOW_BLUR
      ctx.fillStyle = vn.color
      drawNodeShape(ctx, vn.node, vn.node.x, vn.node.y, vn.r)
      ctx.fill()
    }
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
  }

  // Focal node glow (strong)
  const focalEntry = visibleNodes.find((v) => v.isFocal)
  if (focalEntry) {
    ctx.shadowColor = hexToRgba(focalEntry.color, 0.6)
    ctx.shadowBlur = FOCAL_SHADOW_BLUR
    ctx.fillStyle = focalEntry.color
    drawNodeShape(ctx, focalEntry.node, focalEntry.node.x, focalEntry.node.y, focalEntry.r)
    ctx.fill()
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
  }

  // Selected node: teal ring
  if (selectedId) {
    const selEntry = visibleNodes.find((v) => v.node.id === selectedId)
    if (selEntry) {
      ctx.strokeStyle = GRAPH_PALETTE.selectedRing
      ctx.lineWidth = SELECTED_RING_WIDTH
      ctx.globalAlpha = 1
      ctx.beginPath()
      ctx.arc(selEntry.node.x, selEntry.node.y, selEntry.r + 4, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
  ctx.globalAlpha = 1

  // -----------------------------------------------------------------------
  // Stage 5: LABELS — drawn BELOW node center
  // -----------------------------------------------------------------------

  ctx.font = LABEL_FONT
  ctx.textAlign = 'center'

  for (const vn of visibleNodes) {
    if (vn.isDimmed) continue

    const isFocused = vn.isFocal
    const isHovered = vn.node.id === hoveredId
    const isNeighbor = vn.isNeighbor

    const showLabel =
      isFocused ||
      isHovered ||
      (isNeighbor && highlightActive && transform.k >= textFadeThreshold) ||
      transform.k >= textFadeThreshold

    if (!showLabel) continue
    if (!vn.matchesSearch && !isFocused && !isHovered) continue

    let labelAlpha = 0.7
    if (isFocused || isHovered) {
      labelAlpha = 1
    } else {
      const fadeRange = 0.5
      const excess = transform.k - textFadeThreshold
      labelAlpha = Math.min(0.7, Math.max(0, (excess / fadeRange) * 0.7))
    }

    ctx.globalAlpha = labelAlpha
    ctx.fillStyle = GRAPH_PALETTE.labelColor
    ctx.fillText(vn.node.title, vn.node.x, vn.node.y + vn.r + LABEL_OFFSET_BELOW)
  }
  ctx.globalAlpha = 1

  // Stage 6: Frame budget
  const duration = performance.now() - t0
  if (duration > 16) {
    console.warn(`[GraphRenderer] frame budget exceeded: ${duration.toFixed(2)}ms`)
  }

  return duration
}

// ---------------------------------------------------------------------------
// Quadtree-based hit testing
// ---------------------------------------------------------------------------

let nodeQuadtree: Quadtree<SimNode> | null = null

/** Rebuild the quadtree from current node positions. Call each frame. */
export function updateQuadtree(nodes: readonly SimNode[]): void {
  nodeQuadtree = quadtree<SimNode>()
    .x((d) => d.x)
    .y((d) => d.y)
    .addAll(nodes.filter((n) => n.x && n.y) as SimNode[])
}

/** Find nearest node within generous hit radius using quadtree. */
export function findNodeAt(
  nodes: readonly SimNode[],
  x: number,
  y: number,
  multiplier: number = 1
): SimNode | null {
  // Rebuild quadtree if stale (fallback: always rebuild, ~0.1ms for 500 nodes)
  if (!nodeQuadtree || nodeQuadtree.size() !== nodes.filter((n) => n.x && n.y).length) {
    updateQuadtree(nodes)
  }
  if (!nodeQuadtree) return null

  let closest: SimNode | null = null
  let closestDist = Infinity

  // Search within a generous radius (max node size + padding)
  const searchRadius = 24 * multiplier
  const x0 = x - searchRadius
  const y0 = y - searchRadius
  const x1 = x + searchRadius
  const y1 = y + searchRadius

  nodeQuadtree.visit((quadNode, qx0, qy0, qx1, qy1) => {
    if (!quadNode.length) {
      // Leaf node — check each point in this cell
      let current: typeof quadNode | undefined = quadNode
      do {
        const d = current.data
        const r = computeNodeRadius(d, multiplier) + 8 // generous hit area
        const dx = x - d.x
        const dy = y - d.y
        const dist = Math.sqrt(dx * dx + dy * dy)

        if (dist < r && dist < closestDist) {
          closest = d
          closestDist = dist
        }

        current = current.next
      } while (current)
    }

    // Prune branches outside the search area
    return qx0 > x1 || qy0 > y1 || qx1 < x0 || qy1 < y0
  })

  return closest
}
