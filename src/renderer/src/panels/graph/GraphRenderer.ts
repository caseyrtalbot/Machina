import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type Simulation,
  type ForceManyBody,
  type ForceLink,
  type ForceCenter
} from 'd3-force'
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
import type { GraphRenderRuntime } from './graph-runtime'

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
// Memoized color utility caches (pure function caches, deterministic)
// ---------------------------------------------------------------------------

const hexToRgbaCache = new Map<string, string>()
const lightenHexCache = new Map<string, string>()

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
// Update simulation forces (hot-path for settings changes)
// ---------------------------------------------------------------------------

export function updateSimulationForces(
  sim: Simulation<SimNode, SimEdge>,
  config: SimulationConfig
): void {
  const charge = sim.force('charge') as ForceManyBody<SimNode> | undefined
  if (charge) charge.strength(config.repelForce)
  const link = sim.force('link') as ForceLink<SimNode, SimEdge> | undefined
  if (link) {
    link.strength((d: SimEdge) => Math.abs(LINK_STRENGTH[d.kind]) * config.linkForce)
    link.distance(config.linkDistance)
  }
  const center = sim.force('center') as ForceCenter<SimNode> | undefined
  if (center) center.strength(config.centerForce)
  sim.alpha(0.3).restart()
}

// ---------------------------------------------------------------------------
// Node radius: sqrt(inbound links), min 3px, max 16px
// Tag nodes are 0.7x the note size
// ---------------------------------------------------------------------------

export function computeNodeRadius(node: SimNode, multiplier: number = 1): number {
  const base = Math.min(16, Math.max(3, Math.sqrt(Math.max(1, node.connectionCount)) * 3))
  const typeScale = node.type === 'tag' ? 0.7 : 1
  return base * typeScale * multiplier
}

// ---------------------------------------------------------------------------
// Node color: resolved from _color (group rule) or defaults
// ---------------------------------------------------------------------------

export function resolveNodeColor(node: SimNode): string {
  if (node._color) return node._color
  if (node.type === 'tag') return GRAPH_PALETTE.defaultTag
  if (node.type === 'attachment') return GRAPH_PALETTE.defaultAttach
  return GRAPH_PALETTE.defaultNote
}

// ---------------------------------------------------------------------------
// Color utilities (memoized)
// ---------------------------------------------------------------------------

function hexToRgba(hex: string, alpha: number): string {
  const key = `${hex}:${alpha}`
  const cached = hexToRgbaCache.get(key)
  if (cached !== undefined) return cached
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const result = `rgba(${r}, ${g}, ${b}, ${alpha})`
  hexToRgbaCache.set(key, result)
  return result
}

function lightenHex(hex: string, factor: number): string {
  const key = `${hex}:${factor}`
  const cached = lightenHexCache.get(key)
  if (cached !== undefined) return cached
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const lr = Math.min(255, Math.round(r + (255 - r) * factor))
  const lg = Math.min(255, Math.round(g + (255 - g) * factor))
  const lb = Math.min(255, Math.round(b + (255 - b) * factor))
  const result = `#${lr.toString(16).padStart(2, '0')}${lg.toString(16).padStart(2, '0')}${lb.toString(16).padStart(2, '0')}`
  lightenHexCache.set(key, result)
  return result
}

// ---------------------------------------------------------------------------
// Coordinate guard
// ---------------------------------------------------------------------------

function hasValidCoords(node: SimNode): boolean {
  return Number.isFinite(node.x) && Number.isFinite(node.y)
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

export function renderVignette(
  ctx: CanvasRenderingContext2D,
  runtime: GraphRenderRuntime,
  w: number,
  h: number
): void {
  ctx.fillStyle = runtime.getVignetteGradient(ctx, w, h)
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
// Arrowhead: trace only (no beginPath/closePath/fill per arrow)
// ---------------------------------------------------------------------------

function traceArrowhead(
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

  ctx.moveTo(tipX, tipY)
  ctx.lineTo(
    tipX - ux * ARROW_SIZE + uy * ARROW_SIZE * 0.4,
    tipY - uy * ARROW_SIZE - ux * ARROW_SIZE * 0.4
  )
  ctx.lineTo(
    tipX - ux * ARROW_SIZE - uy * ARROW_SIZE * 0.4,
    tipY - uy * ARROW_SIZE + ux * ARROW_SIZE * 0.4
  )
  ctx.lineTo(tipX, tipY)
}

// ---------------------------------------------------------------------------
// Main render function
// ---------------------------------------------------------------------------

export function renderGraph(
  ctx: CanvasRenderingContext2D,
  runtime: GraphRenderRuntime,
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
      if (!hasValidCoords(source) || !hasValidCoords(target)) continue
      if (!isEdgeConnected(edge, connectedSet)) continue
      ctx.moveTo(source.x, source.y)
      ctx.lineTo(target.x, target.y)
    }
    ctx.stroke()

    // Arrowheads for highlighted edges (batched)
    if (showArrows) {
      ctx.fillStyle = GRAPH_PALETTE.linkActive
      ctx.beginPath()
      for (const edge of edges) {
        const source = edge.source as SimNode
        const target = edge.target as SimNode
        if (!hasValidCoords(source) || !hasValidCoords(target)) continue
        if (!isEdgeConnected(edge, connectedSet)) continue
        const tr = computeNodeRadius(target, multiplier)
        traceArrowhead(ctx, source.x, source.y, target.x, target.y, tr)
      }
      ctx.fill()
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
      if (!hasValidCoords(source) || !hasValidCoords(target)) continue
      ctx.moveTo(source.x, source.y)
      ctx.lineTo(target.x, target.y)
    }
    ctx.stroke()

    // Arrowheads for normal mode (batched)
    if (showArrows) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.04)'
      ctx.beginPath()
      for (const edge of edges) {
        const source = edge.source as SimNode
        const target = edge.target as SimNode
        if (!hasValidCoords(source) || !hasValidCoords(target)) continue
        const tr = computeNodeRadius(target, multiplier)
        traceArrowhead(ctx, source.x, source.y, target.x, target.y, tr)
      }
      ctx.fill()
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
    if (!hasValidCoords(node)) continue
    if (!isNodeInView(node, cullBounds)) continue

    const isFocal = node.id === focusedNodeId
    const isNeighbor = !isFocal && connectedSet.has(node.id)
    const isDimmed = highlightActive && !isFocal && !isNeighbor
    const matchesSearch = !searchQuery || node.title.toLowerCase().includes(searchQuery)
    const r = computeNodeRadius(node, multiplier)
    const color = resolveNodeColor(node)

    visibleNodes.push({ node, r, color, isFocal, isNeighbor, isDimmed, matchesSearch })
  }

  // -----------------------------------------------------------------------
  // Stage 3: BOKEH pass -- dimmed/defocused nodes (glow sprites)
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
      const bokehColor = hexToRgba(color, BOKEH_FILL_ALPHA)
      const sprite = runtime.glowCache.get(bokehColor, 8, BOKEH_SHADOW_BLUR)

      for (const vn of group) {
        const bokehR = vn.r * BOKEH_RADIUS_SCALE
        const scale = (bokehR * 2 + BOKEH_SHADOW_BLUR * 2) / sprite.width
        ctx.globalAlpha = BOKEH_SHADOW_ALPHA
        ctx.drawImage(
          sprite.source,
          vn.node.x - (sprite.width * scale) / 2,
          vn.node.y - (sprite.height * scale) / 2,
          sprite.width * scale,
          sprite.height * scale
        )
      }

      // Also draw the actual bokeh circles (fill only, no stroke)
      ctx.globalAlpha = 1
      ctx.fillStyle = hexToRgba(color, BOKEH_FILL_ALPHA)
      for (const vn of group) {
        ctx.beginPath()
        ctx.arc(vn.node.x, vn.node.y, vn.r * BOKEH_RADIUS_SCALE, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
  ctx.globalAlpha = 1

  // -----------------------------------------------------------------------
  // Stage 4: BRIGHT pass -- focal + neighbor nodes
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

  // Neighbor glow (glow sprite)
  if (highlightActive) {
    for (const vn of visibleNodes) {
      if (!vn.isNeighbor) continue
      const glowColor = hexToRgba(vn.color, 0.6)
      const sprite = runtime.glowCache.get(glowColor, vn.r, NEIGHBOR_SHADOW_BLUR)
      ctx.globalAlpha = 0.6
      ctx.drawImage(
        sprite.source,
        vn.node.x - sprite.width / 2,
        vn.node.y - sprite.height / 2
      )
    }
    ctx.globalAlpha = 1
  }

  // Focal node glow (glow sprite)
  const focalEntry = visibleNodes.find((v) => v.isFocal)
  if (focalEntry) {
    const glowColor = hexToRgba(focalEntry.color, 0.6)
    const sprite = runtime.glowCache.get(glowColor, focalEntry.r, FOCAL_SHADOW_BLUR)
    ctx.globalAlpha = 0.6
    ctx.drawImage(
      sprite.source,
      focalEntry.node.x - sprite.width / 2,
      focalEntry.node.y - sprite.height / 2
    )
    ctx.globalAlpha = 1
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
  // Stage 4b: Retained exit overlay
  // -----------------------------------------------------------------------

  runtime.pruneCompletedExits()
  if (runtime.retainedExits.size > 0) {
    const now = performance.now()
    for (const [, exit] of runtime.retainedExits) {
      const elapsed = now - exit.startTime
      const t = Math.min(1, elapsed / exit.duration)
      const opacity = 1 - t
      const scale = 1 - 0.5 * t
      if (opacity <= 0) continue
      ctx.globalAlpha = opacity
      const r = computeNodeRadius(exit.node, options.nodeSizeMultiplier) * scale
      ctx.fillStyle = resolveNodeColor(exit.node)
      drawNodeShape(ctx, exit.node, exit.node.x, exit.node.y, r)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  // -----------------------------------------------------------------------
  // Stage 5: LABELS -- drawn BELOW node center
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
