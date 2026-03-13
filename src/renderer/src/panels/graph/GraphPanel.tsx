import { useRef, useEffect, useCallback } from 'react'
import { zoom, type D3ZoomEvent } from 'd3-zoom'
import { select } from 'd3-selection'
import { useVaultStore } from '../../store/vault-store'
import { useGraphStore } from '../../store/graph-store'
import {
  createSimulation,
  renderGraph,
  findNodeAt,
  type SimNode,
  type SimEdge
} from './GraphRenderer'
import { colors } from '../../design/tokens'

interface GraphPanelProps {
  onNodeClick: (id: string) => void
}

export function GraphPanel({ onNodeClick }: GraphPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const simRef = useRef<ReturnType<typeof createSimulation> | null>(null)
  const nodesRef = useRef<SimNode[]>([])
  const edgesRef = useRef<SimEdge[]>([])
  const transformRef = useRef({ x: 0, y: 0, k: 1 })

  const { getGraph } = useVaultStore()
  const { selectedNodeId, hoveredNodeId, setSelectedNode, setHoveredNode } = useGraphStore()

  const render = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.save()
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const t = transformRef.current
    ctx.translate(t.x, t.y)
    ctx.scale(t.k, t.k)
    renderGraph(
      ctx,
      nodesRef.current,
      edgesRef.current,
      canvas.width,
      canvas.height,
      selectedNodeId,
      hoveredNodeId
    )
    ctx.restore()
  }, [selectedNodeId, hoveredNodeId])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const graph = getGraph()
    const nodes: SimNode[] = graph.nodes.map((n) => ({
      ...n,
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height
    }))
    const edges: SimEdge[] = graph.edges.map((e) => ({ ...e }))

    nodesRef.current = nodes
    edgesRef.current = edges

    let sim: ReturnType<typeof createSimulation> | null = null
    if (nodes.length > 0) {
      sim = createSimulation(nodes, edges, canvas.width, canvas.height)
      sim.on('tick', render)
      simRef.current = sim
    } else {
      render()
    }

    const zoomBehavior = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event: D3ZoomEvent<HTMLCanvasElement, unknown>) => {
        transformRef.current = event.transform
        render()
      })

    const selection = select(canvas).call(zoomBehavior)

    return () => {
      sim?.stop()
      selection.on('.zoom', null)
    }
  }, [getGraph, render])

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const t = transformRef.current
      const x = (e.clientX - rect.left - t.x) / t.k
      const y = (e.clientY - rect.top - t.y) / t.k
      const node = findNodeAt(nodesRef.current, x, y)
      setHoveredNode(node?.id ?? null)
      canvas.style.cursor = node ? 'pointer' : 'default'
    },
    [setHoveredNode]
  )

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const t = transformRef.current
      const x = (e.clientX - rect.left - t.x) / t.k
      const y = (e.clientY - rect.top - t.y) / t.k
      const node = findNodeAt(nodesRef.current, x, y)
      if (node) {
        setSelectedNode(node.id)
        onNodeClick(node.id)
      } else {
        setSelectedNode(null)
      }
    },
    [setSelectedNode, onNodeClick]
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver(() => {
      canvas.width = canvas.clientWidth * window.devicePixelRatio
      canvas.height = canvas.clientHeight * window.devicePixelRatio
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
      render()
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [render])

  const graph = getGraph()
  const isEmpty = graph.nodes.length === 0

  return (
    <div className="h-full relative" style={{ backgroundColor: colors.bg.base }}>
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ backgroundColor: colors.bg.base }}
        onMouseMove={handleMouseMove}
        onClick={handleClick}
      />
      {isEmpty && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ color: colors.text.muted }}
        >
          <div className="text-center">
            <p className="text-lg mb-2">No notes yet</p>
            <p className="text-sm">Create a note to see your knowledge graph</p>
          </div>
        </div>
      )}
    </div>
  )
}
