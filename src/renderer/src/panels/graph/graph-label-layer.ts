import type { SimNode, GraphViewport, LodLevel } from './graph-types'
import { shouldShowLabel } from './graph-lod'
import { SIGNAL_OPACITY } from '@shared/types'

export class LabelLayer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private dpr: number

  constructor() {
    this.canvas = document.createElement('canvas')
    this.canvas.style.position = 'absolute'
    this.canvas.style.inset = '0'
    this.canvas.style.pointerEvents = 'none'
    this.ctx = this.canvas.getContext('2d')!
    this.dpr = window.devicePixelRatio || 1
  }

  mount(container: HTMLElement): void {
    container.appendChild(this.canvas)
    this.resize(container.clientWidth, container.clientHeight)
  }

  destroy(): void {
    this.canvas.remove()
  }

  resize(width: number, height: number): void {
    this.dpr = window.devicePixelRatio || 1
    this.canvas.width = width * this.dpr
    this.canvas.height = height * this.dpr
    this.canvas.style.width = `${width}px`
    this.canvas.style.height = `${height}px`
  }

  render(
    nodes: SimNode[],
    positions: Float32Array,
    viewport: GraphViewport,
    lod: LodLevel,
    hoveredIndex: number | null,
    neighborSet: Set<number> | null
  ): void {
    const { ctx, dpr } = this
    const w = this.canvas.width
    const h = this.canvas.height

    ctx.clearRect(0, 0, w, h)

    if (lod === 'macro') return

    ctx.save()
    ctx.scale(dpr, dpr)

    const cw = w / dpr
    const ch = h / dpr

    const fontSize = Math.min(Math.max(11 / viewport.scale, 8), 14)
    ctx.font = `500 ${fontSize}px "DM Sans", system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'

    for (let i = 0; i < nodes.length; i++) {
      if (!shouldShowLabel(lod, nodes[i].connectionCount)) continue

      const wx = positions[i * 2]
      const wy = positions[i * 2 + 1]
      if (wx === undefined || wy === undefined) continue

      const sx = cw / 2 + viewport.x + wx * viewport.scale
      const sy = ch / 2 + viewport.y + wy * viewport.scale

      if (sx < -100 || sx > cw + 100 || sy < -50 || sy > ch + 50) continue

      let alpha = SIGNAL_OPACITY[nodes[i].signal]
      if (nodes[i].isGhost) alpha = 0.3

      if (neighborSet && !neighborSet.has(i)) alpha *= 0.1

      if (i === hoveredIndex) alpha = 1.0

      const yOffset = 8 + Math.sqrt(nodes[i].connectionCount) * 2.5

      ctx.globalAlpha = alpha
      ctx.strokeStyle = 'rgba(20, 20, 20, 0.8)'
      ctx.lineWidth = 3
      ctx.strokeText(nodes[i].id, sx, sy + yOffset)
      ctx.fillStyle = '#e2e8f0'
      ctx.fillText(nodes[i].id, sx, sy + yOffset)
    }

    ctx.restore()
  }
}
