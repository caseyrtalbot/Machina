import { useRef, useEffect, useCallback } from 'react'
import type { SimNode, SimEdge } from './GraphRenderer'
import { ARTIFACT_COLORS } from '../../design/tokens'

interface GraphMinimapProps {
  nodes: readonly SimNode[]
  edges: readonly SimEdge[]
  transform: { x: number; y: number; k: number }
  canvasWidth: number
  canvasHeight: number
  onPan: (x: number, y: number) => void
}

const MINIMAP_WIDTH = 120
const MINIMAP_HEIGHT = 80
const MINIMAP_PADDING = 8
const NODE_DOT_SIZE = 2
const VIEWPORT_RECT_COLOR = 'rgba(108, 99, 255, 0.5)'
const VIEWPORT_RECT_BORDER = 'rgba(108, 99, 255, 0.8)'
const MINIMAP_BG = 'rgba(17, 17, 19, 0.85)'

interface GraphBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function computeGraphBounds(nodes: readonly SimNode[]): GraphBounds {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 100, maxY: 100 }
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const node of nodes) {
    if (node.x < minX) minX = node.x
    if (node.y < minY) minY = node.y
    if (node.x > maxX) maxX = node.x
    if (node.y > maxY) maxY = node.y
  }

  const rangeX = maxX - minX
  const rangeY = maxY - minY
  const padX = rangeX * 0.1
  const padY = rangeY * 0.1

  return {
    minX: minX - padX,
    minY: minY - padY,
    maxX: maxX + padX,
    maxY: maxY + padY
  }
}

export function GraphMinimap({
  nodes,
  edges,
  transform,
  canvasWidth,
  canvasHeight,
  onPan
}: GraphMinimapProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = MINIMAP_WIDTH * dpr
    canvas.height = MINIMAP_HEIGHT * dpr

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.scale(dpr, dpr)

    // Fill background
    ctx.fillStyle = MINIMAP_BG
    ctx.fillRect(0, 0, MINIMAP_WIDTH, MINIMAP_HEIGHT)

    if (nodes.length === 0) return

    const bounds = computeGraphBounds(nodes)
    const boundsW = bounds.maxX - bounds.minX
    const boundsH = bounds.maxY - bounds.minY

    if (boundsW === 0 || boundsH === 0) return

    const drawW = MINIMAP_WIDTH - MINIMAP_PADDING * 2
    const drawH = MINIMAP_HEIGHT - MINIMAP_PADDING * 2

    const scaleX = drawW / boundsW
    const scaleY = drawH / boundsH
    const scale = Math.min(scaleX, scaleY)

    // Center the scaled graph within the drawing area
    const scaledW = boundsW * scale
    const scaledH = boundsH * scale
    const offsetX = MINIMAP_PADDING + (drawW - scaledW) / 2
    const offsetY = MINIMAP_PADDING + (drawH - scaledH) / 2

    function toMinimapX(graphX: number): number {
      return offsetX + (graphX - bounds.minX) * scale
    }

    function toMinimapY(graphY: number): number {
      return offsetY + (graphY - bounds.minY) * scale
    }

    // Draw edges as faint lines
    ctx.globalAlpha = 0.15
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 0.5
    ctx.beginPath()

    for (const edge of edges) {
      const source = edge.source as SimNode
      const target = edge.target as SimNode
      if (!source.x || !target.x) continue

      ctx.moveTo(toMinimapX(source.x), toMinimapY(source.y))
      ctx.lineTo(toMinimapX(target.x), toMinimapY(target.y))
    }
    ctx.stroke()

    // Draw nodes as colored dots
    ctx.globalAlpha = 0.7

    for (const node of nodes) {
      if (!node.x || !node.y) continue

      const mx = toMinimapX(node.x)
      const my = toMinimapY(node.y)
      const color = ARTIFACT_COLORS[node.type] ?? ARTIFACT_COLORS.note

      ctx.fillStyle = color
      ctx.fillRect(mx - NODE_DOT_SIZE / 2, my - NODE_DOT_SIZE / 2, NODE_DOT_SIZE, NODE_DOT_SIZE)
    }

    ctx.globalAlpha = 1

    // Compute viewport rect in graph-space, then map to minimap coords
    // The visible graph region: from (-transform.x / transform.k) to ((canvasWidth - transform.x) / transform.k)
    const viewGraphMinX = -transform.x / transform.k
    const viewGraphMinY = -transform.y / transform.k
    const viewGraphMaxX = (canvasWidth - transform.x) / transform.k
    const viewGraphMaxY = (canvasHeight - transform.y) / transform.k

    const rectX = toMinimapX(viewGraphMinX)
    const rectY = toMinimapY(viewGraphMinY)
    const rectW = (viewGraphMaxX - viewGraphMinX) * scale
    const rectH = (viewGraphMaxY - viewGraphMinY) * scale

    // Filled viewport rect
    ctx.fillStyle = VIEWPORT_RECT_COLOR
    ctx.globalAlpha = 0.15
    ctx.fillRect(rectX, rectY, rectW, rectH)
    ctx.globalAlpha = 1

    // Stroked viewport border
    ctx.strokeStyle = VIEWPORT_RECT_BORDER
    ctx.lineWidth = 1
    ctx.strokeRect(rectX, rectY, rectW, rectH)
  }, [nodes, edges, transform, canvasWidth, canvasHeight])

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas || nodes.length === 0) return

      const rect = canvas.getBoundingClientRect()
      const clickX = e.clientX - rect.left
      const clickY = e.clientY - rect.top

      const bounds = computeGraphBounds(nodes)
      const boundsW = bounds.maxX - bounds.minX
      const boundsH = bounds.maxY - bounds.minY

      if (boundsW === 0 || boundsH === 0) return

      const drawW = MINIMAP_WIDTH - MINIMAP_PADDING * 2
      const drawH = MINIMAP_HEIGHT - MINIMAP_PADDING * 2

      const scaleX = drawW / boundsW
      const scaleY = drawH / boundsH
      const scale = Math.min(scaleX, scaleY)

      const scaledW = boundsW * scale
      const scaledH = boundsH * scale
      const offsetX = MINIMAP_PADDING + (drawW - scaledW) / 2
      const offsetY = MINIMAP_PADDING + (drawH - scaledH) / 2

      // Convert minimap click coords back to graph-space
      const graphX = bounds.minX + (clickX - offsetX) / scale
      const graphY = bounds.minY + (clickY - offsetY) / scale

      onPan(graphX, graphY)
    },
    [nodes, onPan]
  )

  return (
    <canvas
      ref={canvasRef}
      width={MINIMAP_WIDTH}
      height={MINIMAP_HEIGHT}
      onClick={handleClick}
      style={{ width: MINIMAP_WIDTH, height: MINIMAP_HEIGHT }}
      className="absolute bottom-3 left-3 cursor-crosshair rounded z-10"
    />
  )
}
