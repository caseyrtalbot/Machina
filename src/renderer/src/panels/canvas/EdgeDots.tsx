import { useMemo, useState, useCallback } from 'react'
import { useCanvasStore } from '../../store/canvas-store'
import { EDGE_KIND_COLORS, transitions } from '../../design/tokens'
import type { CanvasNode } from '@shared/canvas-types'

const DOT_SIZE = 8
const PADDING = 20
const DEFAULT_COLOR = '#667383'

function getNodeTitle(node: CanvasNode): string {
  if (node.type === 'note' || node.type === 'file-view') {
    return node.content?.split('/').pop()?.replace(/\.md$/, '') ?? 'Note'
  }
  if (node.type === 'terminal') return 'Terminal'
  if (node.type === 'text') return node.content?.slice(0, 30) ?? 'Text'
  return node.type
}

function isNodeInViewport(
  node: CanvasNode,
  vpLeft: number,
  vpTop: number,
  vpRight: number,
  vpBottom: number
): boolean {
  return (
    node.position.x + node.size.width >= vpLeft &&
    node.position.x <= vpRight &&
    node.position.y + node.size.height >= vpTop &&
    node.position.y <= vpBottom
  )
}

interface EdgeDotsProps {
  readonly containerWidth: number
  readonly containerHeight: number
}

export function EdgeDots({ containerWidth, containerHeight }: EdgeDotsProps) {
  const nodes = useCanvasStore((s) => s.nodes)
  const edges = useCanvasStore((s) => s.edges)
  const viewport = useCanvasStore((s) => s.viewport)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const dots = useMemo(() => {
    if (edges.length === 0 || nodes.length === 0) return []

    // Viewport bounds in canvas space
    const vpLeft = -viewport.x / viewport.zoom
    const vpTop = -viewport.y / viewport.zoom
    const vpRight = (-viewport.x + containerWidth) / viewport.zoom
    const vpBottom = (-viewport.y + containerHeight) / viewport.zoom

    const nodeMap = new Map<string, CanvasNode>()
    for (const node of nodes) {
      nodeMap.set(node.id, node)
    }

    // Deduplicate: one dot per off-screen node
    const seen = new Map<
      string,
      { x: number; y: number; color: string; targetNodeId: string; title: string }
    >()

    for (const edge of edges) {
      const fromNode = nodeMap.get(edge.fromNode)
      const toNode = nodeMap.get(edge.toNode)
      if (!fromNode || !toNode) continue

      const fromVisible = isNodeInViewport(fromNode, vpLeft, vpTop, vpRight, vpBottom)
      const toVisible = isNodeInViewport(toNode, vpLeft, vpTop, vpRight, vpBottom)

      // Only when one end is visible and the other is off-screen
      if (fromVisible === toVisible) continue

      const offScreen = fromVisible ? toNode : fromNode
      if (seen.has(offScreen.id)) continue

      // Off-screen node center in screen space
      const cx = (offScreen.position.x + offScreen.size.width / 2) * viewport.zoom + viewport.x
      const cy = (offScreen.position.y + offScreen.size.height / 2) * viewport.zoom + viewport.y

      // Clamp to viewport boundary
      const x = Math.max(PADDING, Math.min(containerWidth - PADDING, cx))
      const y = Math.max(PADDING, Math.min(containerHeight - PADDING, cy))

      const color = edge.kind ? (EDGE_KIND_COLORS[edge.kind] ?? DEFAULT_COLOR) : DEFAULT_COLOR

      seen.set(offScreen.id, {
        x,
        y,
        color,
        targetNodeId: offScreen.id,
        title: getNodeTitle(offScreen)
      })
    }

    return Array.from(seen.values())
  }, [nodes, edges, viewport, containerWidth, containerHeight])

  const handleClick = useCallback((nodeId: string) => {
    const { centerOnNode, setFocusedCard } = useCanvasStore.getState()
    centerOnNode?.(nodeId)
    setFocusedCard(nodeId)
  }, [])

  if (dots.length === 0) return null

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 5 }}>
      {dots.map((dot) => {
        const isHovered = hoveredId === dot.targetNodeId
        return (
          <div
            key={dot.targetNodeId}
            className="absolute pointer-events-auto"
            style={{
              left: dot.x - DOT_SIZE / 2,
              top: dot.y - DOT_SIZE / 2,
              width: DOT_SIZE,
              height: DOT_SIZE,
              borderRadius: '50%',
              backgroundColor: dot.color,
              cursor: 'pointer',
              opacity: isHovered ? 1 : 0.7,
              transform: isHovered ? 'scale(1.3)' : 'scale(1)',
              transition: `opacity ${transitions.slow}, transform ${transitions.slow}`
            }}
            onClick={() => handleClick(dot.targetNodeId)}
            onMouseEnter={() => setHoveredId(dot.targetNodeId)}
            onMouseLeave={() => setHoveredId(null)}
            title={dot.title}
          />
        )
      })}
    </div>
  )
}
