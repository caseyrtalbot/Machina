import { Application, Container, Graphics } from 'pixi.js'
import { quadtree as d3Quadtree, type Quadtree } from 'd3-quadtree'
import type { SimNode, GraphViewport, LodLevel } from './graph-types'
import type { RelationshipKind } from '@shared/types'
import { SIGNAL_OPACITY } from '@shared/types'
import { nodeColorForType, buildEdgeColor, edgeOpacity } from './graph-theme-bridge'
import { getGraphLod, nodeRadius, edgeWidth } from './graph-lod'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EdgeData {
  readonly sourceIndex: number
  readonly targetIndex: number
  readonly kind: RelationshipKind
}

export interface RendererCallbacks {
  readonly onNodeHover: (nodeIndex: number | null) => void
  readonly onNodeClick: (nodeIndex: number) => void
  readonly onNodeDrag: (nodeIndex: number, x: number, y: number) => void
  readonly onNodeDragEnd: (nodeIndex: number) => void
  readonly onViewportChange: (viewport: GraphViewport) => void
  readonly onDeselect: () => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_ZOOM = 0.05
const MAX_ZOOM = 5.0
const ZOOM_FACTOR = 1.08
const DRAG_THRESHOLD = 5
const NODE_STROKE_COLOR = 0x94a3b8
const NODE_STROKE_ALPHA = 0.7
const GHOST_ALPHA = 0.7
const NEIGHBOR_DIM_FACTOR = 0.3
const NEIGHBOR_EDGE_ALPHA = 0.9
const NON_NEIGHBOR_EDGE_ALPHA = 0.05
const HIGHLIGHT_EDGE_COLOR = 0x4ade80
const HIGHLIGHT_GLOW_ALPHA = 0.25
const HIGHLIGHT_GLOW_WIDTH_MULT = 4
const HIT_RADIUS = 20
const SELECTION_RING_COLOR = 0x60a5fa
const ORIGIN_SOURCE_STROKE = 0x60a5fa // blue for source material
const ORIGIN_AGENT_STROKE = 0x4ade80 // green for agent-compiled

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Draw a dashed circle using line segments (PixiJS Graphics has no native dash support). */
function drawDashedCircle(
  g: Graphics,
  radius: number,
  color: number,
  alpha: number,
  dashLen = 4,
  gapLen = 3
): void {
  const circumference = 2 * Math.PI * radius
  const segmentLen = dashLen + gapLen
  const segments = Math.floor(circumference / segmentLen)
  const dashAngle = (dashLen / circumference) * 2 * Math.PI
  const gapAngle = (gapLen / circumference) * 2 * Math.PI

  for (let i = 0; i < segments; i++) {
    const startAngle = i * (dashAngle + gapAngle)
    const endAngle = startAngle + dashAngle
    const steps = Math.max(2, Math.ceil((dashAngle * radius) / 2))

    for (let s = 0; s <= steps; s++) {
      const angle = startAngle + (endAngle - startAngle) * (s / steps)
      const x = Math.cos(angle) * radius
      const y = Math.sin(angle) * radius
      if (s === 0) {
        g.moveTo(x, y)
      } else {
        g.lineTo(x, y)
      }
    }
    g.stroke({ width: 1.5, color, alpha })
  }
}

// ---------------------------------------------------------------------------
// GraphRenderer
// ---------------------------------------------------------------------------

interface DisplayOptions {
  readonly showEdges: boolean
  readonly showGhostNodes: boolean
  readonly showOrphanNodes: boolean
  readonly nodeScale: number
}

export class GraphRenderer {
  // PixiJS objects (created on mount)
  private app: Application | null = null
  private worldContainer: Container | null = null
  private edgeGraphics: Graphics | null = null
  private nodeGraphics: Graphics[] = []

  // Data
  private nodes: readonly SimNode[] = []
  private edges: readonly EdgeData[] = []
  private positions: Float32Array = new Float32Array(0)
  private adjacency: Map<number, Set<number>> = new Map()

  // Display options
  private displayOptions: DisplayOptions = {
    showEdges: true,
    showGhostNodes: true,
    showOrphanNodes: true,
    nodeScale: 1.0
  }

  // Viewport
  private viewport: GraphViewport = { x: 0, y: 0, scale: 1 }
  private canvasWidth = 0
  private canvasHeight = 0

  // Selection + interaction state
  private highlightedNode: number | null = null
  private selectedNodeIndex: number | null = null
  private selectionRing: Graphics | null = null
  private dragNodeIndex: number | null = null
  private isPanning = false
  private pointerDownPos = { x: 0, y: 0 }
  private pointerDownViewport = { x: 0, y: 0 }
  private pointerMoved = false

  // Render loop
  private animFrameId: number | null = null
  private paused = true
  private mounted = false
  private destroyed = false
  private dirty = true

  // Cached spatial index (invalidated on position/graph data update)
  private cachedQuadtree: Quadtree<number> | null = null

  // Callbacks
  private readonly callbacks: RendererCallbacks

  // Bound handlers (for cleanup)
  private readonly boundWheel: (e: WheelEvent) => void
  private readonly boundPointerDown: (e: PointerEvent) => void
  private readonly boundPointerMove: (e: PointerEvent) => void
  private readonly boundPointerUp: (e: PointerEvent) => void

  constructor(callbacks: RendererCallbacks) {
    this.callbacks = callbacks
    this.boundWheel = this.handleWheel.bind(this)
    this.boundPointerDown = this.handlePointerDown.bind(this)
    this.boundPointerMove = this.handlePointerMove.bind(this)
    this.boundPointerUp = this.handlePointerUp.bind(this)
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async mount(container: HTMLElement): Promise<void> {
    const app = new Application()
    await app.init({
      preference: 'webgl',
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      backgroundAlpha: 0,
      resizeTo: container
    })

    // Bail out if destroyed while awaiting init (fast tab switch)
    if (this.destroyed) {
      app.destroy(true)
      return
    }

    const canvasEl = app.canvas as HTMLCanvasElement
    canvasEl.style.position = 'absolute'
    canvasEl.style.top = '0'
    canvasEl.style.left = '0'
    container.appendChild(canvasEl)
    this.app = app
    this.canvasWidth = app.canvas.width / (window.devicePixelRatio || 1)
    this.canvasHeight = app.canvas.height / (window.devicePixelRatio || 1)

    // World container holds all graph elements
    const world = new Container()
    app.stage.addChild(world)
    this.worldContainer = world

    // Edge layer (single Graphics, redrawn each frame)
    const edgeGfx = new Graphics()
    world.addChild(edgeGfx)
    this.edgeGraphics = edgeGfx

    // Selection ring (drawn above nodes)
    const selRing = new Graphics()
    selRing.visible = false
    world.addChild(selRing)
    this.selectionRing = selRing

    // Rebuild node graphics if data was set before mount
    if (this.nodes.length > 0) {
      this.rebuildNodeGraphics()
    }

    // Attach interaction handlers to the canvas
    const canvas = app.canvas as HTMLCanvasElement
    canvas.addEventListener('wheel', this.boundWheel, { passive: false })
    canvas.addEventListener('pointerdown', this.boundPointerDown)
    canvas.addEventListener('pointermove', this.boundPointerMove)
    canvas.addEventListener('pointerup', this.boundPointerUp)
    canvas.addEventListener('pointerleave', this.boundPointerUp)

    this.mounted = true
    this.paused = false
    this.startRenderLoop()
  }

  destroy(): void {
    this.paused = true
    this.mounted = false
    this.destroyed = true

    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId)
      this.animFrameId = null
    }

    if (this.app) {
      const canvas = this.app.canvas as HTMLCanvasElement
      canvas.removeEventListener('wheel', this.boundWheel)
      canvas.removeEventListener('pointerdown', this.boundPointerDown)
      canvas.removeEventListener('pointermove', this.boundPointerMove)
      canvas.removeEventListener('pointerup', this.boundPointerUp)
      canvas.removeEventListener('pointerleave', this.boundPointerUp)

      canvas.parentElement?.removeChild(canvas)
      this.app.destroy(true)
      this.app = null
    }

    this.worldContainer = null
    this.edgeGraphics = null
    this.selectionRing = null
    this.nodeGraphics = []
    this.cachedQuadtree = null
  }

  pause(): void {
    this.paused = true
  }

  resume(): void {
    if (!this.paused) return
    this.paused = false
    if (this.mounted) {
      this.markDirty()
    }
  }

  isPaused(): boolean {
    return this.paused
  }

  // -------------------------------------------------------------------------
  // Data
  // -------------------------------------------------------------------------

  setGraphData(nodes: readonly SimNode[], edges: readonly EdgeData[]): void {
    this.nodes = nodes
    this.edges = edges
    this.adjacency = buildAdjacency(nodes.length, edges)
    this.cachedQuadtree = null

    if (this.mounted) {
      this.rebuildNodeGraphics()
    }
  }

  setPositions(buffer: Float32Array): void {
    this.positions = buffer
    this.cachedQuadtree = null
    this.markDirty()
  }

  getNodeCount(): number {
    return this.nodes.length
  }

  // -------------------------------------------------------------------------
  // Interaction (public)
  // -------------------------------------------------------------------------

  setHighlightedNode(nodeIndex: number | null): void {
    this.highlightedNode = nodeIndex
    this.updateCursor()
    this.markDirty()
  }

  setSelectedNode(nodeIndex: number | null): void {
    this.selectedNodeIndex = nodeIndex
    this.markDirty()
  }

  setViewport(viewport: GraphViewport): void {
    this.viewport = viewport
    this.callbacks.onViewportChange(viewport)
    this.markDirty()
  }

  getPositions(): Float32Array {
    return this.positions
  }

  getNodes(): readonly SimNode[] {
    return this.nodes
  }

  setDisplayOptions(options: Partial<DisplayOptions>): void {
    this.displayOptions = { ...this.displayOptions, ...options }
    if (this.mounted) {
      this.rebuildNodeGraphics()
    }
  }

  // -------------------------------------------------------------------------
  // Node graphics
  // -------------------------------------------------------------------------

  private rebuildNodeGraphics(): void {
    const world = this.worldContainer
    if (!world) return

    // Remove old node graphics
    for (const g of this.nodeGraphics) {
      world.removeChild(g)
      g.destroy()
    }
    this.nodeGraphics = []

    // Create new node graphics
    const { showGhostNodes, showOrphanNodes, nodeScale } = this.displayOptions

    for (const node of this.nodes) {
      const g = new Graphics()
      const radius = nodeRadius(node.connectionCount) * nodeScale
      const color = nodeColorForType(node.type)

      if (node.isGhost) {
        // Ghost nodes: dashed hollow circle
        drawDashedCircle(g, radius, color, 0.8)
      } else {
        g.circle(0, 0, radius)
        g.fill({ color })
        // Origin-based stroke: source gets blue, agent gets green, human gets default
        const strokeColor =
          node.origin === 'source'
            ? ORIGIN_SOURCE_STROKE
            : node.origin === 'agent'
              ? ORIGIN_AGENT_STROKE
              : NODE_STROKE_COLOR
        const strokeWidth = node.origin && node.origin !== 'human' ? 2 : 1
        g.circle(0, 0, radius)
        g.stroke({ width: strokeWidth, color: strokeColor, alpha: NODE_STROKE_ALPHA })
      }

      // Base alpha from signal
      const signalAlpha = SIGNAL_OPACITY[node.signal]
      g.alpha = node.isGhost ? GHOST_ALPHA : signalAlpha

      // Hide based on display options
      if (node.isGhost && !showGhostNodes) g.visible = false
      if (node.connectionCount === 0 && !showOrphanNodes) g.visible = false

      world.addChild(g)
      this.nodeGraphics.push(g)
    }

    // Re-add selection ring on top
    if (this.selectionRing) {
      world.addChild(this.selectionRing)
    }
    this.markDirty()
  }

  // -------------------------------------------------------------------------
  // Render loop
  // -------------------------------------------------------------------------

  private startRenderLoop(): void {
    if (this.animFrameId !== null) return

    const loop = (): void => {
      if (this.paused) {
        this.animFrameId = null
        return
      }
      if (!this.dirty) {
        this.animFrameId = null
        return
      }
      this.dirty = false
      this.renderFrame()
      this.animFrameId = requestAnimationFrame(loop)
    }
    this.animFrameId = requestAnimationFrame(loop)
  }

  private markDirty(): void {
    this.dirty = true
    if (!this.paused && this.mounted && this.animFrameId === null) {
      this.startRenderLoop()
    }
  }

  private renderFrame(): void {
    const world = this.worldContainer
    if (!world || !this.app) return

    // Update canvas dimensions
    this.canvasWidth = this.app.canvas.width / (window.devicePixelRatio || 1)
    this.canvasHeight = this.app.canvas.height / (window.devicePixelRatio || 1)

    const centerX = this.canvasWidth / 2
    const centerY = this.canvasHeight / 2

    // 1. Apply viewport transform
    world.position.set(centerX + this.viewport.x, centerY + this.viewport.y)
    world.scale.set(this.viewport.scale)

    // 2. Get LOD level
    const lod = getGraphLod(this.viewport.scale)

    // 3. Render edges (skip at macro LOD)
    this.renderEdges(lod)

    // 4. Update node positions + apply dimming
    this.updateNodePositions()
  }

  private renderEdges(lod: LodLevel): void {
    const gfx = this.edgeGraphics
    if (!gfx) return

    gfx.clear()

    if (lod === 'macro') return
    if (!this.displayOptions.showEdges) return
    if (this.positions.length === 0) return

    const width = edgeWidth(this.viewport.scale)
    const focusNode = this.highlightedNode ?? this.selectedNodeIndex
    const neighborSet =
      focusNode !== null ? (this.adjacency.get(focusNode) ?? new Set<number>()) : null

    // Compute visible world-space bounds for edge culling.
    // Margin accounts for max Bézier curvature deviation (30px world).
    const { scale } = this.viewport
    const centerX = this.canvasWidth / 2
    const centerY = this.canvasHeight / 2
    const margin = 30
    const worldLeft = (0 - centerX - this.viewport.x) / scale - margin
    const worldRight = (this.canvasWidth - centerX - this.viewport.x) / scale + margin
    const worldTop = (0 - centerY - this.viewport.y) / scale - margin
    const worldBottom = (this.canvasHeight - centerY - this.viewport.y) / scale + margin

    for (const edge of this.edges) {
      const sx = this.positions[edge.sourceIndex * 2]
      const sy = this.positions[edge.sourceIndex * 2 + 1]
      const tx = this.positions[edge.targetIndex * 2]
      const ty = this.positions[edge.targetIndex * 2 + 1]

      if (sx === undefined || sy === undefined || tx === undefined || ty === undefined) continue

      // Skip edges entirely outside the viewport (both endpoints off the same side)
      if (sx < worldLeft && tx < worldLeft) continue
      if (sx > worldRight && tx > worldRight) continue
      if (sy < worldTop && ty < worldTop) continue
      if (sy > worldBottom && ty > worldBottom) continue

      let color = buildEdgeColor(edge.kind)
      let alpha = edgeOpacity(edge.kind)
      let isHighlighted = false

      // Apply neighborhood dimming / highlighting
      if (neighborSet !== null) {
        isHighlighted = edge.sourceIndex === focusNode || edge.targetIndex === focusNode
        if (isHighlighted) {
          color = HIGHLIGHT_EDGE_COLOR
          alpha = NEIGHBOR_EDGE_ALPHA
        } else {
          alpha = NON_NEIGHBOR_EDGE_ALPHA
        }
      }

      // Compute curve control point
      const mx = (sx + tx) / 2
      const my = (sy + ty) / 2
      const dx = tx - sx
      const dy = ty - sy
      const dist = Math.sqrt(dx * dx + dy * dy)
      const curvature = dist > 0 ? Math.min(dist * 0.1, 30) : 0
      const nx = dist > 0 ? (-dy / dist) * curvature : 0
      const ny = dist > 0 ? (dx / dist) * curvature : 0

      // Glow pass for highlighted edges (wider, low-alpha neon green)
      if (isHighlighted) {
        gfx.moveTo(sx, sy)
        if (dist > 0) {
          gfx.quadraticCurveTo(mx + nx, my + ny, tx, ty)
        } else {
          gfx.lineTo(tx, ty)
        }
        gfx.stroke({
          width: width * HIGHLIGHT_GLOW_WIDTH_MULT,
          color: HIGHLIGHT_EDGE_COLOR,
          alpha: HIGHLIGHT_GLOW_ALPHA
        })
      }

      // Core edge pass
      gfx.moveTo(sx, sy)
      if (dist > 0) {
        gfx.quadraticCurveTo(mx + nx, my + ny, tx, ty)
      } else {
        gfx.lineTo(tx, ty)
      }
      gfx.stroke({ width, color, alpha })
    }
  }

  private updateNodePositions(): void {
    if (this.positions.length === 0) return

    const { showGhostNodes, showOrphanNodes, nodeScale } = this.displayOptions

    const focusNode = this.highlightedNode ?? this.selectedNodeIndex
    const neighborSet =
      focusNode !== null ? (this.adjacency.get(focusNode) ?? new Set<number>()) : null

    for (let i = 0; i < this.nodes.length; i++) {
      const g = this.nodeGraphics[i]
      if (!g) continue

      const node = this.nodes[i]

      // Apply visibility filters
      g.visible = true
      if (node.isGhost && !showGhostNodes) {
        g.visible = false
        continue
      }
      if (node.connectionCount === 0 && !showOrphanNodes) {
        g.visible = false
        continue
      }

      const x = this.positions[i * 2]
      const y = this.positions[i * 2 + 1]
      if (x === undefined || y === undefined) continue

      g.position.set(x, y)

      // Hovered node: scale up for glow effect
      const isHighlighted = i === focusNode
      g.scale.set(isHighlighted ? 1.2 : 1)

      // Compute alpha
      const baseAlpha = node.isGhost ? GHOST_ALPHA : SIGNAL_OPACITY[node.signal]

      if (neighborSet !== null) {
        const isNeighbor = neighborSet.has(i)
        g.alpha = isHighlighted || isNeighbor ? baseAlpha : baseAlpha * NEIGHBOR_DIM_FACTOR
      } else {
        g.alpha = baseAlpha
      }
    }

    // Update selection ring
    this.updateSelectionRing(nodeScale)
  }

  private updateSelectionRing(nodeScale: number): void {
    const ring = this.selectionRing
    if (!ring) return

    if (this.selectedNodeIndex === null) {
      ring.visible = false
      return
    }

    const node = this.nodes[this.selectedNodeIndex]
    if (!node) {
      ring.visible = false
      return
    }

    const x = this.positions[this.selectedNodeIndex * 2]
    const y = this.positions[this.selectedNodeIndex * 2 + 1]
    if (x === undefined || y === undefined) {
      ring.visible = false
      return
    }

    const radius = nodeRadius(node.connectionCount) * nodeScale + 4
    ring.clear()
    ring.circle(0, 0, radius)
    ring.stroke({ width: 2, color: SELECTION_RING_COLOR, alpha: 0.9 })
    ring.position.set(x, y)
    ring.visible = true
  }

  // -------------------------------------------------------------------------
  // Cursor management
  // -------------------------------------------------------------------------

  private updateCursor(): void {
    if (!this.app) return
    const canvas = this.app.canvas as HTMLCanvasElement

    if (this.dragNodeIndex !== null) {
      canvas.style.cursor = 'grabbing'
    } else if (this.isPanning) {
      canvas.style.cursor = 'grabbing'
    } else if (this.highlightedNode !== null) {
      canvas.style.cursor = 'pointer'
    } else {
      canvas.style.cursor = 'grab'
    }
  }

  // -------------------------------------------------------------------------
  // Coordinate conversion
  // -------------------------------------------------------------------------

  private screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    const centerX = this.canvasWidth / 2
    const centerY = this.canvasHeight / 2
    return {
      x: (screenX - centerX - this.viewport.x) / this.viewport.scale,
      y: (screenY - centerY - this.viewport.y) / this.viewport.scale
    }
  }

  // -------------------------------------------------------------------------
  // Quadtree hover detection
  // -------------------------------------------------------------------------

  private findNodeAtScreen(screenX: number, screenY: number): number | null {
    if (this.nodes.length === 0 || this.positions.length === 0) return null

    const world = this.screenToWorld(screenX, screenY)
    const hitRadius = HIT_RADIUS / this.viewport.scale

    if (!this.cachedQuadtree) {
      this.cachedQuadtree = d3Quadtree<number>()
        .x((i) => this.positions[i * 2])
        .y((i) => this.positions[i * 2 + 1])
        .addAll(Array.from({ length: this.nodes.length }, (_, i) => i))
    }

    const found = this.cachedQuadtree.find(world.x, world.y, hitRadius)
    return found ?? null
  }

  // -------------------------------------------------------------------------
  // Interaction handlers
  // -------------------------------------------------------------------------

  private handleWheel(e: WheelEvent): void {
    e.preventDefault()

    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    const centerX = this.canvasWidth / 2
    const centerY = this.canvasHeight / 2

    const direction = e.deltaY > 0 ? -1 : 1
    const ratio = Math.pow(ZOOM_FACTOR, direction)
    const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.viewport.scale * ratio))
    const actualRatio = newScale / this.viewport.scale

    // Adjust pan so point under cursor stays fixed
    const newX = mouseX - actualRatio * (mouseX - centerX - this.viewport.x) - centerX
    const newY = mouseY - actualRatio * (mouseY - centerY - this.viewport.y) - centerY

    this.viewport = { x: newX, y: newY, scale: newScale }
    this.callbacks.onViewportChange(this.viewport)
    this.markDirty()
  }

  private handlePointerDown(e: PointerEvent): void {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
    const screenX = e.clientX - rect.left
    const screenY = e.clientY - rect.top

    this.pointerDownPos = { x: screenX, y: screenY }
    this.pointerMoved = false

    const hitNode = this.findNodeAtScreen(screenX, screenY)

    if (hitNode !== null) {
      // Start node drag
      this.dragNodeIndex = hitNode
      const world = this.screenToWorld(screenX, screenY)
      this.callbacks.onNodeDrag(hitNode, world.x, world.y)
    } else {
      // Start canvas pan
      this.isPanning = true
      this.pointerDownViewport = { x: this.viewport.x, y: this.viewport.y }
    }
    this.updateCursor()
  }

  private handlePointerMove(e: PointerEvent): void {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
    const screenX = e.clientX - rect.left
    const screenY = e.clientY - rect.top

    const dx = screenX - this.pointerDownPos.x
    const dy = screenY - this.pointerDownPos.y
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
      this.pointerMoved = true
    }

    if (this.dragNodeIndex !== null) {
      // Dragging a node
      const world = this.screenToWorld(screenX, screenY)
      this.callbacks.onNodeDrag(this.dragNodeIndex, world.x, world.y)
    } else if (this.isPanning) {
      // Panning the canvas
      this.viewport = {
        x: this.pointerDownViewport.x + dx,
        y: this.pointerDownViewport.y + dy,
        scale: this.viewport.scale
      }
      this.callbacks.onViewportChange(this.viewport)
      this.markDirty()
    } else {
      // Hover detection
      const hitNode = this.findNodeAtScreen(screenX, screenY)
      if (hitNode !== this.highlightedNode) {
        this.highlightedNode = hitNode
        this.callbacks.onNodeHover(hitNode)
        this.updateCursor()
        this.markDirty()
      }
    }
  }

  private handlePointerUp(_e: PointerEvent): void {
    if (this.dragNodeIndex !== null) {
      if (!this.pointerMoved) {
        // Click (didn't move enough to be a drag)
        this.callbacks.onNodeClick(this.dragNodeIndex)
      } else {
        this.callbacks.onNodeDragEnd(this.dragNodeIndex)
      }
    } else if (this.isPanning && !this.pointerMoved) {
      // Tap on empty canvas (not a pan gesture) — clear selection
      this.callbacks.onDeselect()
    }

    this.dragNodeIndex = null
    this.isPanning = false
    this.pointerMoved = false
    this.updateCursor()
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildAdjacency(nodeCount: number, edges: readonly EdgeData[]): Map<number, Set<number>> {
  const adj = new Map<number, Set<number>>()
  for (let i = 0; i < nodeCount; i++) {
    adj.set(i, new Set())
  }
  for (const edge of edges) {
    adj.get(edge.sourceIndex)?.add(edge.targetIndex)
    adj.get(edge.targetIndex)?.add(edge.sourceIndex)
  }
  return adj
}
