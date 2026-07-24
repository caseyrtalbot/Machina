import { useMemo, memo } from 'react'
import { useCanvas, useCanvasApi } from './canvas-store-context'
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

import { getEdgeStrokeDasharray, getEdgeStrokeWidth } from './edge-styling'

/** User-drawn edge kinds (ConnectionDragOverlay): always faintly visible.
 *  Structural kinds (imports/references/contains/ontology/cluster) stay
 *  demand-revealed to keep dense canvases readable. */
const USER_EDGE_KINDS = new Set(['connection', 'tension', 'causal'])
const BASELINE_EDGE_OPACITY = 0.25

interface EdgePathProps {
  readonly edge: CanvasEdge
  readonly nodeMap: ReadonlyMap<string, CanvasNode>
  readonly zoom: number
}

function EdgePathInner({ edge, nodeMap, zoom }: EdgePathProps) {
  const canvas = useCanvasApi()
  const isSelected = useCanvas((s) => s.selectedEdgeId === edge.id)
  const selectedNodeIds = useCanvas((s) => s.selectedNodeIds)
  const hoveredNodeId = useCanvas((s) => s.hoveredNodeId)
  const showAllEdges = useCanvas((s) => s.showAllEdges)

  const from_node = nodeMap.get(edge.fromNode)
  const to_node = nodeMap.get(edge.toNode)
  if (!from_node || !to_node) return null

  // Demand-rendering: determine if this edge should be visually shown
  const endpointHovered = hoveredNodeId === edge.fromNode || hoveredNodeId === edge.toNode
  const endpointSelected = selectedNodeIds.has(edge.fromNode) || selectedNodeIds.has(edge.toNode)
  const zoomRevealed = zoom > 0.8 && (edge.kind === 'imports' || edge.kind === 'references')
  const isRevealed =
    showAllEdges || isSelected || endpointHovered || endpointSelected || zoomRevealed
  // User-created edges are always visible at low opacity ("see connections"
  // is pillar 1); only the noisy structural kinds are demand-revealed.
  const baselineVisible = edge.kind !== undefined && USER_EDGE_KINDS.has(edge.kind)
  const isShown = isRevealed || baselineVisible
  // No invisible-but-clickable edges: the hit path mounts only when shown,
  // so a hidden edge can never be selected and deleted unseen.
  if (!isShown) return null

  const kindColor = edge.kind ? EDGE_KIND_COLORS[edge.kind] : undefined
  const strokeDasharray = getEdgeStrokeDasharray(edge.kind)
  const strokeWidthBase = getEdgeStrokeWidth(edge.kind)
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
      {/* Hit area: rendered only while the edge is visibly shown */}
      <path
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={12}
        className="te-cv-edge-hit"
        onClick={(e) => {
          e.stopPropagation()
          canvas.getState().setSelectedEdge(edge.id)
        }}
      />
      <path
        d={d}
        fill="none"
        stroke={isSelected ? colors.accent.default : (kindColor ?? colors.text.secondary)}
        strokeWidth={isSelected ? 2.5 : strokeWidthBase}
        markerEnd="url(#arrowhead)"
        opacity={endpointActive || isSelected ? 1 : isRevealed ? 0.6 : BASELINE_EDGE_OPACITY}
        strokeDasharray={endpointActive ? '8 4' : strokeDasharray}
        className="te-cv-edge-path"
        data-edge-state={endpointActive ? 'active' : isRevealed ? 'revealed' : undefined}
      />
    </g>
  )
}

const MemoEdgePath = memo(
  EdgePathInner,
  (prev, next) =>
    prev.edge === next.edge && prev.nodeMap === next.nodeMap && prev.zoom === next.zoom
)

export function EdgeLayer() {
  const nodes = useCanvas((s) => s.nodes)
  const edges = useCanvas((s) => s.edges)
  const zoom = useCanvas((s) => s.viewport.zoom)

  const nodeMap = useMemo(() => {
    const m = new Map<string, CanvasNode>()
    for (const n of nodes) m.set(n.id, n)
    return m
  }, [nodes])

  return (
    <svg className="te-cv-edge-layer" width="1" height="1">
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
      <g className="te-cv-edge-hitgroup">
        {edges.map((edge) => (
          <MemoEdgePath key={edge.id} edge={edge} nodeMap={nodeMap} zoom={zoom} />
        ))}
      </g>
    </svg>
  )
}
