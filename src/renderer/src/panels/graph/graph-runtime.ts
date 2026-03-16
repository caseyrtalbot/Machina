import { quadtree, type Quadtree } from 'd3-quadtree'
import type { Simulation } from 'd3-force'
import { GlowCache } from './glow-cache'
import type { SimNode, SimEdge } from './graph-config'

export interface RetainedExit {
  node: SimNode
  startTime: number
  duration: number
}

export interface PerfCounters {
  lastFrameMs: number
  frameCount: number
}

export class GraphRenderRuntime {
  // Public readonly
  readonly glowCache = new GlowCache()
  readonly retainedExits = new Map<string, RetainedExit>()
  readonly perf: PerfCounters = { lastFrameMs: 0, frameCount: 0 }

  // Private
  private _quadtree: Quadtree<SimNode> | null = null
  private _quadtreeDirty = true
  private _vignetteCache: { gradient: CanvasGradient; w: number; h: number } | null = null
  private _pendingRaf: number | null = null
  private _renderFn: () => void
  private _simulation: Simulation<SimNode, SimEdge> | null = null

  constructor(renderFn: () => void) {
    this._renderFn = renderFn
  }

  // ---------------------------------------------------------------------------
  // RAF-coalesced render scheduling
  // ---------------------------------------------------------------------------

  requestRender(): void {
    if (this._pendingRaf !== null) return
    this._pendingRaf = requestAnimationFrame(() => {
      this._pendingRaf = null
      this._renderFn()
    })
  }

  // ---------------------------------------------------------------------------
  // Quadtree
  // ---------------------------------------------------------------------------

  isQuadtreeDirty(): boolean {
    return this._quadtreeDirty
  }

  markQuadtreeDirty(): void {
    this._quadtreeDirty = true
  }

  rebuildQuadtree(nodes: readonly SimNode[]): void {
    if (!this._quadtreeDirty) return
    const valid = nodes.filter((n) => Number.isFinite(n.x) && Number.isFinite(n.y))
    this._quadtree = quadtree<SimNode>()
      .x((n) => n.x)
      .y((n) => n.y)
      .addAll(valid as SimNode[])
    this._quadtreeDirty = false
  }

  // ---------------------------------------------------------------------------
  // Hit testing
  // ---------------------------------------------------------------------------

  findNodeAt(nodes: readonly SimNode[], x: number, y: number, sizeMultiplier = 1): SimNode | null {
    if (this._quadtree === null) {
      this.rebuildQuadtree(nodes)
    }
    if (this._quadtree === null) return null

    const searchRadius = 24 * sizeMultiplier
    let closest: SimNode | null = null
    let closestDist = Infinity

    this._quadtree.visit((node, x0, y0, x1, y1) => {
      // Leaf node check
      if (node.length === undefined) {
        let p: typeof node | undefined = node
        while (p !== undefined) {
          const d = p.data
          if (Number.isFinite(d.x) && Number.isFinite(d.y)) {
            const hitRadius =
              Math.min(16, Math.max(3, Math.sqrt(Math.max(1, d.connectionCount)) * 3)) *
                sizeMultiplier +
              8
            const dx = d.x - x
            const dy = d.y - y
            const dist = Math.sqrt(dx * dx + dy * dy)
            if (dist < hitRadius && dist < closestDist) {
              closestDist = dist
              closest = d
            }
          }
          p = p.next
        }
      }
      // Return true to skip subtree if bounding box is too far
      return (
        x0 > x + searchRadius ||
        x1 < x - searchRadius ||
        y0 > y + searchRadius ||
        y1 < y - searchRadius
      )
    })

    return closest
  }

  // ---------------------------------------------------------------------------
  // Vignette cache
  // ---------------------------------------------------------------------------

  getVignetteGradient(ctx: CanvasRenderingContext2D, w: number, h: number): CanvasGradient {
    if (
      this._vignetteCache !== null &&
      this._vignetteCache.w === w &&
      this._vignetteCache.h === h
    ) {
      return this._vignetteCache.gradient
    }
    const gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) / 2)
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)')
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0.4)')
    this._vignetteCache = { gradient, w, h }
    return gradient
  }

  // ---------------------------------------------------------------------------
  // Simulation (stops old sim when setting new one)
  // ---------------------------------------------------------------------------

  get simulation(): Simulation<SimNode, SimEdge> | null {
    return this._simulation
  }

  set simulation(sim: Simulation<SimNode, SimEdge> | null) {
    if (this._simulation !== null) {
      this._simulation.stop()
    }
    this._simulation = sim
  }

  // ---------------------------------------------------------------------------
  // Retained exits
  // ---------------------------------------------------------------------------

  addRetainedExit(node: SimNode, duration: number): void {
    this.retainedExits.set(node.id, { node, startTime: performance.now(), duration })
  }

  pruneCompletedExits(): void {
    const now = performance.now()
    for (const [id, exit] of this.retainedExits) {
      if (now - exit.startTime >= exit.duration) {
        this.retainedExits.delete(id)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  dispose(): void {
    if (this._pendingRaf !== null) {
      cancelAnimationFrame(this._pendingRaf)
      this._pendingRaf = null
    }
    if (this._simulation !== null) {
      this._simulation.stop()
      this._simulation = null
    }
    this.glowCache.dispose()
    this.retainedExits.clear()
    this._quadtree = null
    this._quadtreeDirty = true
    this._vignetteCache = null
  }
}
