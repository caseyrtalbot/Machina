import { useRef, useEffect, useCallback } from 'react'
import type { SimNode, SimEdge } from './graph-config'

interface GraphMinimapProps {
  nodes: readonly SimNode[]
  edges: readonly SimEdge[]
  transform: { x: number; y: number; k: number }
  canvasWidth: number
  canvasHeight: number
  highlightedNodeIds: ReadonlySet<string>
  onPan: (x: number, y: number) => void
}

const MINIMAP_WIDTH = 160
const MINIMAP_HEIGHT = 120
const MINIMAP_PADDING = 8

const MINIMAP_BG = 'rgba(15, 15, 25, 0.85)'
const MINIMAP_BORDER = 'rgba(255, 255, 255, 0.1)'
const EDGE_COLOR = '#e2e8f0'
const VIEWPORT_STROKE = 'rgba(255, 255, 255, 0.5)'
const VIEWPORT_FILL = 'rgba(255, 255, 255, 0.1)'

const DEFAULT_NOTE_COLOR = '#8a8a9e'

const DOT_SIZE_NORMAL = 1.5
const DOT_SIZE_HIGHLIGHTED = 2.5
const DOT_ALPHA_NORMAL = 0.5
const DOT_ALPHA_HIGHLIGHTED = 1.0

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

function getNodeDotColor(node: SimNode): string {
  if (node._color) return node._color
  return DEFAULT_NOTE_COLOR
}

export function GraphMinimap({
  nodes,
  edges,
  transform,
  canvasWidth,
  canvasHeight,
  highlightedNodeIds,
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
    ctx.strokeStyle = EDGE_COLOR
    ctx.lineWidth = 0.5
    ctx.beginPath()

    for (const edge of edges) {
      const source = edge.source as SimNode
      const target = edge.target as SimNode
      if (!Number.isFinite(source.x) || !Number.isFinite(source.y)) continue
      if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) continue

      ctx.moveTo(toMinimapX(source.x), toMinimapY(source.y))
      ctx.lineTo(toMinimapX(target.x), toMinimapY(target.y))
    }
    ctx.stroke()

    // Pass 1: non-highlighted nodes (faint)
    ctx.globalAlpha = DOT_ALPHA_NORMAL
    for (const node of nodes) {
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) continue
      if (highlightedNodeIds.has(node.id)) continue

      const mx = toMinimapX(node.x)
      const my = toMinimapY(node.y)
      ctx.fillStyle = getNodeDotColor(node)
      ctx.fillRect(
        mx - DOT_SIZE_NORMAL / 2,
        my - DOT_SIZE_NORMAL / 2,
        DOT_SIZE_NORMAL,
        DOT_SIZE_NORMAL
      )
    }

    // Pass 2: highlighted nodes drawn on top (bright)
    ctx.globalAlpha = DOT_ALPHA_HIGHLIGHTED
    for (const node of nodes) {
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) continue
      if (!highlightedNodeIds.has(node.id)) continue

      const mx = toMinimapX(node.x)
      const my = toMinimapY(node.y)
      ctx.fillStyle = getNodeDotColor(node)
      ctx.fillRect(
        mx - DOT_SIZE_HIGHLIGHTED / 2,
        my - DOT_SIZE_HIGHLIGHTED / 2,
        DOT_SIZE_HIGHLIGHTED,
        DOT_SIZE_HIGHLIGHTED
      )
    }

    ctx.globalAlpha = 1

    // Compute viewport rect in graph-space, then map to minimap coords
    const viewGraphMinX = -transform.x / transform.k
    const viewGraphMinY = -transform.y / transform.k
    const viewGraphMaxX = (canvasWidth - transform.x) / transform.k
    const viewGraphMaxY = (canvasHeight - transform.y) / transform.k

    const rectX = toMinimapX(viewGraphMinX)
    const rectY = toMinimapY(viewGraphMinY)
    const rectW = (viewGraphMaxX - viewGraphMinX) * scale
    const rectH = (viewGraphMaxY - viewGraphMinY) * scale

    // Clip to minimap bounds so viewport rect never overflows
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, MINIMAP_WIDTH, MINIMAP_HEIGHT)
    ctx.clip()

    // Filled viewport rect
    ctx.fillStyle = VIEWPORT_FILL
    ctx.globalAlpha = 1
    ctx.fillRect(rectX, rectY, rectW, rectH)

    // Stroked viewport border
    ctx.strokeStyle = VIEWPORT_STROKE
    ctx.globalAlpha = 1
    ctx.lineWidth = 1
    ctx.strokeRect(rectX, rectY, rectW, rectH)
    ctx.restore()
  }, [nodes, edges, transform, canvasWidth, canvasHeight, highlightedNodeIds])

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
      style={{
        width: MINIMAP_WIDTH,
        height: MINIMAP_HEIGHT,
        border: `1px solid ${MINIMAP_BORDER}`,
        borderRadius: 6
      }}
      className="absolute bottom-3 left-3 cursor-crosshair z-10"
    />
  )
}
