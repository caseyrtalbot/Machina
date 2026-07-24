import { useMemo, useCallback } from 'react'
import { useCanvas, useCanvasApi } from './canvas-store-context'
import { EDGE_KIND_COLORS } from '../../design/tokens'
import type { CanvasNode } from '@shared/canvas-types'

const DOT_SIZE = 8
const PADDING = 20
const DEFAULT_COLOR = EDGE_KIND_COLORS.connection

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
  const canvas = useCanvasApi()
  const nodes = useCanvas((s) => s.nodes)
  const edges = useCanvas((s) => s.edges)
  const viewport = useCanvas((s) => s.viewport)
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

  const handleClick = useCallback(
    (nodeId: string) => {
      const { centerOnNode, setFocusedCard } = canvas.getState()
      centerOnNode?.(nodeId)
      setFocusedCard(nodeId)
    },
    [canvas]
  )

  if (dots.length === 0) return null

  return (
    <div className="te-cv-edgedots">
      {dots.map((dot) => (
        <div
          key={dot.targetNodeId}
          className="edge-dot te-cv-edgedot"
          style={{
            left: dot.x - DOT_SIZE / 2,
            top: dot.y - DOT_SIZE / 2,
            backgroundColor: dot.color
          }}
          onClick={() => handleClick(dot.targetNodeId)}
          title={dot.title}
        />
      ))}
    </div>
  )
}
