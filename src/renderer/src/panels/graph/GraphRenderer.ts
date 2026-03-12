import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type Simulation
} from 'd3-force'
import type { GraphNode, RelationshipKind } from '@shared/types'
import { ARTIFACT_COLORS, colors } from '../../design/tokens'
import { SIGNAL_OPACITY } from '@shared/types'

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

const LINK_STRENGTH: Record<RelationshipKind, number> = {
  connection: 0.3,
  cluster: 0.6,
  tension: -0.2,
  appears_in: 0.2
}

export function createSimulation(
  nodes: SimNode[],
  edges: SimEdge[],
  width: number,
  height: number
): Simulation<SimNode, SimEdge> {
  return forceSimulation<SimNode>(nodes)
    .force(
      'link',
      forceLink<SimNode, SimEdge>(edges)
        .id((d) => d.id)
        .strength((d) => Math.abs(LINK_STRENGTH[d.kind]))
    )
    .force('charge', forceManyBody<SimNode>().strength(-120))
    .force('center', forceCenter(width / 2, height / 2))
    .force(
      'collide',
      forceCollide<SimNode>().radius((d) => nodeRadius(d.connectionCount) + 4)
    )
}

export function nodeRadius(connectionCount: number): number {
  return Math.min(18, Math.max(6, 6 + connectionCount * 2))
}

export function renderGraph(
  ctx: CanvasRenderingContext2D,
  nodes: SimNode[],
  edges: SimEdge[],
  width: number,
  height: number,
  selectedId: string | null,
  hoveredId: string | null
): void {
  ctx.clearRect(0, 0, width, height)

  const gradient = ctx.createRadialGradient(
    width / 2,
    height / 2,
    0,
    width / 2,
    height / 2,
    width / 2
  )
  gradient.addColorStop(0, '#111113')
  gradient.addColorStop(1, colors.bg.base)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  for (const edge of edges) {
    const source = edge.source as SimNode
    const target = edge.target as SimNode
    if (!source.x || !target.x) continue

    ctx.beginPath()
    ctx.moveTo(source.x, source.y)
    ctx.lineTo(target.x, target.y)

    switch (edge.kind) {
      case 'connection':
        ctx.strokeStyle = colors.border.default
        ctx.lineWidth = 1
        ctx.setLineDash([])
        break
      case 'cluster':
        ctx.strokeStyle = colors.semantic.cluster + '66'
        ctx.lineWidth = 1.5
        ctx.setLineDash([])
        break
      case 'tension':
        ctx.strokeStyle = colors.semantic.tension + '66'
        ctx.lineWidth = 1
        ctx.setLineDash([4, 4])
        break
      case 'appears_in':
        ctx.strokeStyle = '#3A3A3E'
        ctx.lineWidth = 1
        ctx.setLineDash([])
        break
    }
    ctx.stroke()
    ctx.setLineDash([])
  }

  for (const node of nodes) {
    if (!node.x || !node.y) continue
    const r = nodeRadius(node.connectionCount)
    const color = ARTIFACT_COLORS[node.type] || ARTIFACT_COLORS.note
    const opacity = SIGNAL_OPACITY[node.signal] || 0.4
    const isSelected = node.id === selectedId
    const isHovered = node.id === hoveredId

    if (isSelected || isHovered) {
      ctx.shadowColor = color
      ctx.shadowBlur = 12
    }

    ctx.beginPath()
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.globalAlpha = opacity
    ctx.fill()
    ctx.globalAlpha = 1

    if (isSelected) {
      ctx.strokeStyle = colors.accent.default
      ctx.lineWidth = 2
      ctx.stroke()
    }

    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0

    if (isHovered) {
      ctx.fillStyle = colors.text.primary
      ctx.font = '12px Inter, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(node.title, node.x, node.y - r - 6)
    }
  }
}

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
