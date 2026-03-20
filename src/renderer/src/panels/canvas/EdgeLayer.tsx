import { useCanvasStore } from '../../store/canvas-store'
import { colors, EDGE_KIND_COLORS } from '../../design/tokens'
import type { CanvasEdge, CanvasNode, CanvasSide } from '@shared/canvas-types'

function getAnchorPoint(node: CanvasNode, side: CanvasSide): { x: number; y: number } {
  const { x, y } = node.position
  const { width, height } = node.size

  switch (side) {
    case 'top':
      return { x: x + width / 2, y }
    case 'bottom':
      return { x: x + width / 2, y: y + height }
    case 'left':
      return { x, y: y + height / 2 }
    case 'right':
      return { x: x + width, y: y + height / 2 }
  }
}

function getControlOffset(side: CanvasSide, distance: number): { dx: number; dy: number } {
  const offset = Math.min(distance * 0.4, 120)
  switch (side) {
    case 'top':
      return { dx: 0, dy: -offset }
    case 'bottom':
      return { dx: 0, dy: offset }
    case 'left':
      return { dx: -offset, dy: 0 }
    case 'right':
      return { dx: offset, dy: 0 }
  }
}

function EdgePath({ edge, nodes }: { edge: CanvasEdge; nodes: readonly CanvasNode[] }) {
  const isSelected = useCanvasStore((s) => s.selectedEdgeId === edge.id)

  const from_node = nodes.find((n) => n.id === edge.fromNode)
  const to_node = nodes.find((n) => n.id === edge.toNode)
  if (!from_node || !to_node) return null

  const kindColor = edge.kind ? EDGE_KIND_COLORS[edge.kind] : undefined
  const endpointActive =
    from_node.metadata?.isActive === true || to_node.metadata?.isActive === true

  const from = getAnchorPoint(from_node, edge.fromSide)
  const to = getAnchorPoint(to_node, edge.toSide)

  const dist = Math.sqrt((to.x - from.x) ** 2 + (to.y - from.y) ** 2)
  const cp1 = getControlOffset(edge.fromSide, dist)
  const cp2 = getControlOffset(edge.toSide, dist)

  const d = `M ${from.x} ${from.y} C ${from.x + cp1.dx} ${from.y + cp1.dy}, ${to.x + cp2.dx} ${to.y + cp2.dy}, ${to.x} ${to.y}`

  return (
    <g data-canvas-edge>
      {/* Hit area (wider invisible path for easier clicking) */}
      <path
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={12}
        style={{ cursor: 'pointer' }}
        onClick={(e) => {
          e.stopPropagation()
          useCanvasStore.getState().setSelectedEdge(edge.id)
        }}
      />
      {/* Visible edge */}
      <path
        d={d}
        fill="none"
        stroke={isSelected ? colors.accent.default : (kindColor ?? colors.text.secondary)}
        strokeWidth={isSelected ? 2.5 : 1.5}
        markerEnd="url(#arrowhead)"
        opacity={endpointActive ? 1 : isSelected ? 1 : 0.6}
        strokeDasharray={endpointActive ? '8 4' : undefined}
        style={endpointActive ? { animation: 'te-edge-flow 0.8s linear infinite' } : undefined}
      />
    </g>
  )
}

export function EdgeLayer() {
  const nodes = useCanvasStore((s) => s.nodes)
  const edges = useCanvasStore((s) => s.edges)

  return (
    <svg
      className="absolute pointer-events-none"
      width="1"
      height="1"
      style={{ left: 0, top: 0, overflow: 'visible' }}
    >
      <defs>
        <marker
          id="arrowhead"
          markerWidth="10"
          markerHeight="7"
          refX="9"
          refY="3.5"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <polygon points="0 0, 10 3.5, 0 7" fill={colors.text.secondary} opacity="0.8" />
        </marker>
      </defs>
      <g style={{ pointerEvents: 'all' }}>
        {edges.map((edge) => (
          <EdgePath key={edge.id} edge={edge} nodes={nodes} />
        ))}
      </g>
    </svg>
  )
}
