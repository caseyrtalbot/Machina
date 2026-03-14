import { useRef, useEffect, useCallback, useState, useMemo } from 'react'
import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom'
import { select } from 'd3-selection'
import { useVaultStore } from '../../store/vault-store'
import { useGraphStore } from '../../store/graph-store'
import { useGraphSettingsStore, resolveGroupColor } from '../../store/graph-settings-store'
import { GraphRenderRuntime } from './graph-runtime'
import { buildGlobalGraphModel, type GraphFilters } from './graph-model'
import {
  createSimulation,
  renderGraph,
  renderVignette,
  updateSimulationForces
} from './GraphRenderer'
import { GRAPH_PALETTE, type SimNode, type SimEdge, type SimulationConfig } from './graph-config'
import { useGraphHighlight } from './useGraphHighlight'
import { useGraphAnimation } from './useGraphAnimation'
import { useGraphKeyboard } from './useGraphKeyboard'
import { GraphMinimap } from './GraphMinimap'
import { GraphContextMenu } from './GraphContextMenu'
import { GraphSettingsPanel } from './GraphSettingsPanel'

// ---------------------------------------------------------------------------
// Accessibility: reduced motion preference
// ---------------------------------------------------------------------------

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])
  return reduced
}

// ---------------------------------------------------------------------------
// Tooltip state
// ---------------------------------------------------------------------------

interface TooltipState {
  x: number
  y: number
  label: string
  connectionCount: number
}

// ---------------------------------------------------------------------------
// GraphPanel
// ---------------------------------------------------------------------------

interface GraphPanelProps {
  onNodeClick: (id: string) => void
}

export function GraphPanel({ onNodeClick }: GraphPanelProps) {
  // Canvas and simulation refs
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const nodesRef = useRef<SimNode[] | null>(null)
  const edgesRef = useRef<SimEdge[] | null>(null)
  const transformRef = useRef({ x: 0, y: 0, k: 1 })
  const zoomBehaviorRef = useRef<ZoomBehavior<HTMLCanvasElement, unknown> | null>(null)
  const prevNodesRef = useRef<SimNode[]>([])
  const renderRef = useRef<() => void>(() => {})

  // Pane-scoped runtime (lazily created, disposed on unmount)
  const runtimeRef = useRef<GraphRenderRuntime | null>(null)
  if (!runtimeRef.current) {
    runtimeRef.current = new GraphRenderRuntime(() => {
      renderRef.current()
    })
  }

  // Dispose runtime on unmount
  useEffect(() => {
    return () => {
      runtimeRef.current?.dispose()
      runtimeRef.current = null
    }
  }, [])

  // Drag state refs (hot path — no React state)
  const dragNodeRef = useRef<SimNode | null>(null)
  const isDraggingRef = useRef(false)
  const dragStartTimeRef = useRef(0)

  // Visited node tracking (persisted in localStorage)
  const visitedRef = useRef<Set<string>>(
    new Set(JSON.parse(localStorage.getItem('graph-visited') ?? '[]'))
  )

  // Store selectors (narrow to avoid unnecessary re-renders)
  const graph = useVaultStore((s) => s.graph)
  const fileToId = useVaultStore((s) => s.fileToId)
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId)
  const hoveredNodeId = useGraphStore((s) => s.hoveredNodeId)
  const setSelectedNode = useGraphStore((s) => s.setSelectedNode)
  const setContentView = useGraphStore((s) => s.setContentView)

  const searchQuery = useGraphSettingsStore((s) => s.searchQuery)
  const showOrphans = useGraphSettingsStore((s) => s.showOrphans)
  const showExistingOnly = useGraphSettingsStore((s) => s.showExistingOnly)
  const showTags = useGraphSettingsStore((s) => s.showTags)
  const showAttachments = useGraphSettingsStore((s) => s.showAttachments)
  const groupRules = useGraphSettingsStore((s) => s.groupRules)
  const nodeSizeMultiplier = useGraphSettingsStore((s) => s.nodeSizeMultiplier)
  const isAnimating = useGraphSettingsStore((s) => s.isAnimating)
  const showMinimap = useGraphSettingsStore((s) => s.showMinimap)
  const linkThickness = useGraphSettingsStore((s) => s.linkThickness)
  const textFadeThreshold = useGraphSettingsStore((s) => s.textFadeThreshold)
  const showArrows = useGraphSettingsStore((s) => s.showArrows)
  const centerForce = useGraphSettingsStore((s) => s.centerForce)
  const repelForce = useGraphSettingsStore((s) => s.repelForce)
  const linkForceStrength = useGraphSettingsStore((s) => s.linkForce)
  const linkDistance = useGraphSettingsStore((s) => s.linkDistance)
  const enableRadial = useGraphSettingsStore((s) => s.enableRadial)

  // UI state
  const [isFocused, setIsFocused] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    nodeId: string
  } | null>(null)
  const reducedMotion = useReducedMotion()

  // Build reverse map: artifactId → filePath (for group rule path matching)
  const idToPath = useMemo(() => {
    const map = new Map<string, string>()
    for (const [path, id] of Object.entries(fileToId)) {
      map.set(id, path)
    }
    return map
  }, [fileToId])

  // Build GraphModel from graph data + filter settings
  const graphModel = useMemo(() => {
    const filters: GraphFilters = {
      showTags,
      showAttachments,
      showOrphans,
      showExistingOnly,
      searchQuery: '' // search is handled separately in render
    }
    return buildGlobalGraphModel(graph, filters)
  }, [graph, showTags, showAttachments, showOrphans, showExistingOnly])

  // Simulation reheat handler
  const handleSimRestart = useCallback((alpha: number) => {
    runtimeRef.current?.simulation?.alpha(alpha).restart()
  }, [])

  // Integration hooks
  const highlightHook = useGraphHighlight(edgesRef.current ?? [])
  const animation = useGraphAnimation(handleSimRestart, reducedMotion)

  // Positioned nodes for keyboard navigation
  const positionedNodes = useMemo(
    () =>
      (nodesRef.current ?? []).filter(
        (n): n is SimNode & { x: number; y: number } =>
          typeof n.x === 'number' && typeof n.y === 'number'
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodesRef.current]
  )

  // Keyboard navigation
  useGraphKeyboard({
    nodes: positionedNodes,
    edges: (edgesRef.current ?? []).map((e) => ({
      source: typeof e.source === 'string' ? e.source : e.source.id,
      target: typeof e.target === 'string' ? e.target : e.target.id,
      kind: e.kind
    })),
    selectedNodeId,
    onSelectNode: setSelectedNode,
    onOpenNode: (id) => {
      setSelectedNode(id)
      setContentView('editor')
      onNodeClick(id)
    },
    onToggleSelect: (id) => {
      setSelectedNode(selectedNodeId === id ? null : id)
    },
    enabled: isFocused
  })

  // -------------------------------------------------------------------------
  // Render callback
  // -------------------------------------------------------------------------

  const render = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const nodes = nodesRef.current
    const edges = edgesRef.current
    if (!nodes || !edges) return

    const runtime = runtimeRef.current
    if (!runtime) return

    const t = transformRef.current
    const dpr = window.devicePixelRatio
    const w = canvas.width / dpr
    const h = canvas.height / dpr

    // Rebuild quadtree if dirty (runtime manages dirty flag)
    runtime.rebuildQuadtree(nodes)

    // Clear + deep space background (screen-space)
    ctx.save()
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.scale(dpr, dpr)
    ctx.fillStyle = GRAPH_PALETTE.canvasBg
    ctx.fillRect(0, 0, w, h)

    // Apply pan/zoom transform
    ctx.translate(t.x, t.y)
    ctx.scale(t.k, t.k)

    // Render graph content (graph-space)
    renderGraph(ctx, runtime, nodes, edges, w, h, selectedNodeId, hoveredNodeId, {
      highlight: highlightHook.state,
      transform: t,
      canvasWidth: w,
      canvasHeight: h,
      nodeSizeMultiplier,
      linkThickness,
      textFadeThreshold,
      showArrows,
      searchQuery
    })

    ctx.restore()

    // Vignette overlay (screen-space post-effect)
    ctx.save()
    ctx.scale(dpr, dpr)
    renderVignette(ctx, runtime, w, h)
    ctx.restore()

    // Continue render loop while animations are active
    if (animation.hasActiveAnimations()) {
      runtimeRef.current?.requestRender()
    }
  }, [
    selectedNodeId,
    hoveredNodeId,
    nodeSizeMultiplier,
    highlightHook.state,
    animation,
    linkThickness,
    textFadeThreshold,
    showArrows,
    searchQuery
  ])

  // Keep renderRef in sync
  useEffect(() => {
    renderRef.current = render
  }, [render])

  // Re-render on display-only changes (no sim recreation needed)
  useEffect(() => {
    runtimeRef.current?.requestRender()
  }, [
    linkThickness,
    textFadeThreshold,
    showArrows,
    nodeSizeMultiplier,
    searchQuery,
    hoveredNodeId,
    selectedNodeId,
    highlightHook.state
  ])

  // -------------------------------------------------------------------------
  // Effect 1 — Topology change: creates new simulation
  // -------------------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current
    const runtime = runtimeRef.current
    if (!canvas || !runtime) return

    // Build SimNode[] from graphModel, preserving existing positions
    const prevNodeMap = new Map(prevNodesRef.current.map((n) => [n.id, n]))
    const simNodes: SimNode[] = graphModel.nodes.map((n) => {
      const prev = prevNodeMap.get(n.id)
      return {
        ...n,
        x: prev?.x ?? Math.random() * canvas.clientWidth,
        y: prev?.y ?? Math.random() * canvas.clientHeight,
        fx: prev?.fx ?? null,
        fy: prev?.fy ?? null,
        _color: undefined
      }
    })

    const simEdges: SimEdge[] = graphModel.edges.map((e) => ({ ...e }))

    // Assign path from reverse lookup (for group rule matching)
    for (const node of simNodes) {
      const path = idToPath.get(node.id)
      if (path) node.path = path
    }

    // Assign _color from group rules (top-to-bottom, first match wins)
    // and mark visited nodes
    for (const node of simNodes) {
      node._color = resolveGroupColor(groupRules, node) ?? undefined
      node._visited = visitedRef.current.has(node.id)
    }

    // Diff for animations
    const diff = animation.diffNodes(prevNodesRef.current, simNodes)
    animation.detectRenames(diff.removed, diff.added)

    // Update refs
    nodesRef.current = simNodes
    edgesRef.current = simEdges
    prevNodesRef.current = simNodes

    if (diff.added.length > 0) animation.queueEnter(diff.added as SimNode[])
    if (diff.removed.length > 0) animation.queueExit(diff.removed as SimNode[])

    if (simNodes.length > 0) {
      const simConfig: SimulationConfig = {
        centerForce,
        repelForce,
        linkForce: linkForceStrength,
        linkDistance,
        enableRadial
      }

      const sim = createSimulation(
        simNodes,
        simEdges,
        canvas.clientWidth,
        canvas.clientHeight,
        simConfig
      )

      if (!isAnimating) sim.stop()

      sim.on('tick', () => {
        nodesRef.current = simNodes
        edgesRef.current = simEdges
        runtime.markQuadtreeDirty()
        runtime.requestRender()
      })

      // When simulation settles, stop it completely so nodes are static
      sim.on('end', () => {
        runtime.requestRender()
      })

      runtime.simulation = sim
    } else {
      runtime.simulation = null
      runtime.requestRender()
    }

    return () => {
      // Runtime.simulation setter stops the old sim automatically
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphModel, idToPath, groupRules, isAnimating, animation])

  // -------------------------------------------------------------------------
  // Effect 2 — Force parameter change: updates simulation in place
  // -------------------------------------------------------------------------

  useEffect(() => {
    const sim = runtimeRef.current?.simulation
    if (!sim) return
    updateSimulationForces(sim, {
      centerForce,
      repelForce,
      linkForce: linkForceStrength,
      linkDistance
    })
  }, [centerForce, repelForce, linkForceStrength, linkDistance])

  // -------------------------------------------------------------------------
  // Zoom setup (scale 0.1–8 per spec)
  // -------------------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const zb = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.1, 8])
      .filter((event) => {
        // Suppress d3's default drag when we're node-dragging
        if (isDraggingRef.current) return false
        // Suppress d3 pan when mousedown is on a node (let our drag handler take it)
        if (event.type === 'mousedown' || event.type === 'touchstart') {
          const rect = canvas.getBoundingClientRect()
          const t = transformRef.current
          const gx = (event.clientX - rect.left - t.x) / t.k
          const gy = (event.clientY - rect.top - t.y) / t.k
          const hit = runtimeRef.current?.findNodeAt(
            nodesRef.current ?? [],
            gx,
            gy,
            nodeSizeMultiplier
          )
          if (hit) return false // let our mouseDown handle it
        }
        return true
      })
      .on('zoom', (event) => {
        transformRef.current = event.transform
        // Use ref to avoid recreating this effect when render changes
        renderRef.current()
      })

    select(canvas).call(zb)
    zoomBehaviorRef.current = zb

    return () => {
      select(canvas).on('.zoom', null)
    }
    // Intentionally stable — uses renderRef for render, not the render callback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // -------------------------------------------------------------------------
  // Coordinate transform helper
  // -------------------------------------------------------------------------

  const toGraphCoords = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const t = transformRef.current
    return {
      x: (clientX - rect.left - t.x) / t.k,
      y: (clientY - rect.top - t.y) / t.k
    }
  }, [])

  // -------------------------------------------------------------------------
  // Mouse event handlers with drag-to-pin support
  // -------------------------------------------------------------------------

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return // left-click only
      const coords = toGraphCoords(e.clientX, e.clientY)
      if (!coords) return
      const node =
        runtimeRef.current?.findNodeAt(
          nodesRef.current ?? [],
          coords.x,
          coords.y,
          nodeSizeMultiplier
        ) ?? null
      if (node) {
        isDraggingRef.current = true
        dragNodeRef.current = node
        dragStartTimeRef.current = Date.now()
        // Pin the node at its current position
        node.fx = node.x
        node.fy = node.y
        // Gentle reheat — keep neighbors calm while dragging
        runtimeRef.current?.simulation?.alphaTarget(0.1).restart()
        const canvas = canvasRef.current
        if (canvas) canvas.style.cursor = 'grabbing'
      }
    },
    [toGraphCoords, nodeSizeMultiplier]
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const coords = toGraphCoords(e.clientX, e.clientY)
      if (!coords) return

      // Drag-to-pin: move pinned node
      if (isDraggingRef.current && dragNodeRef.current) {
        dragNodeRef.current.fx = coords.x
        dragNodeRef.current.fy = coords.y
        runtimeRef.current?.markQuadtreeDirty()
        // Sim tick already handles requestRender, but force render if sim is stopped
        runtimeRef.current?.requestRender()
        return
      }

      const node =
        runtimeRef.current?.findNodeAt(
          nodesRef.current ?? [],
          coords.x,
          coords.y,
          nodeSizeMultiplier
        ) ?? null
      highlightHook.handleHover(node?.id ?? null)

      const canvas = canvasRef.current
      if (canvas) canvas.style.cursor = node ? 'grab' : 'default'

      // Tooltip
      if (node) {
        const rect = canvas?.getBoundingClientRect()
        setTooltip({
          x: e.clientX - (rect?.left ?? 0),
          y: e.clientY - (rect?.top ?? 0),
          label: node.title,
          connectionCount: node.connectionCount
        })
      } else {
        setTooltip(null)
      }
    },
    [toGraphCoords, highlightHook, nodeSizeMultiplier]
  )

  const handleMouseUp = useCallback(() => {
    if (isDraggingRef.current) {
      const dragDuration = Date.now() - dragStartTimeRef.current
      const draggedNode = dragNodeRef.current

      isDraggingRef.current = false
      dragNodeRef.current = null
      const canvas = canvasRef.current

      // Short drag = click: open the node (Quartz: <500ms threshold)
      if (dragDuration < 500 && draggedNode) {
        // Unpin immediately for clicks
        if (draggedNode) {
          draggedNode.fx = null
          draggedNode.fy = null
        }
        runtimeRef.current?.simulation?.alphaTarget(0)

        // Track as visited
        visitedRef.current.add(draggedNode.id)
        localStorage.setItem('graph-visited', JSON.stringify([...visitedRef.current]))
        draggedNode._visited = true

        highlightHook.handleClick(draggedNode.id)
        onNodeClick(draggedNode.id)
        if (canvas) canvas.style.cursor = 'grab'
      } else {
        // Real drag: spring-back — unpin and let sim gently settle
        if (draggedNode) {
          draggedNode.fx = null
          draggedNode.fy = null
        }
        // Gentle spring-back: low alpha so node drifts back smoothly
        const sim = runtimeRef.current?.simulation
        if (sim) {
          sim.alphaTarget(0).alpha(0.15).restart()
        }
        if (canvas) canvas.style.cursor = 'grab'
      }
    }
  }, [highlightHook, onNodeClick])

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      // Don't select if we were dragging
      if (isDraggingRef.current) return
      setContextMenu(null)
      const coords = toGraphCoords(e.clientX, e.clientY)
      if (!coords) return
      const node =
        runtimeRef.current?.findNodeAt(
          nodesRef.current ?? [],
          coords.x,
          coords.y,
          nodeSizeMultiplier
        ) ?? null
      if (node) {
        // Track as visited
        visitedRef.current.add(node.id)
        localStorage.setItem('graph-visited', JSON.stringify([...visitedRef.current]))
        node._visited = true

        highlightHook.handleClick(node.id)
        onNodeClick(node.id)
      } else {
        highlightHook.handleClick(null)
      }
    },
    [toGraphCoords, highlightHook, onNodeClick, nodeSizeMultiplier]
  )

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const coords = toGraphCoords(e.clientX, e.clientY)
      if (!coords) return
      const node =
        runtimeRef.current?.findNodeAt(
          nodesRef.current ?? [],
          coords.x,
          coords.y,
          nodeSizeMultiplier
        ) ?? null
      if (node) {
        // Double-click: unpin if pinned, otherwise open
        if (node.fx !== undefined && node.fx !== null) {
          node.fx = null
          node.fy = null
          runtimeRef.current?.simulation?.alpha(0.3).restart()
        } else {
          highlightHook.handleDoubleClick(node.id)
          setContentView('editor')
          onNodeClick(node.id)
        }
      }
    },
    [toGraphCoords, highlightHook, setContentView, onNodeClick, nodeSizeMultiplier]
  )

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      e.preventDefault()
      const coords = toGraphCoords(e.clientX, e.clientY)
      if (!coords) return
      const node =
        runtimeRef.current?.findNodeAt(
          nodesRef.current ?? [],
          coords.x,
          coords.y,
          nodeSizeMultiplier
        ) ?? null
      if (node) {
        setContextMenu({ x: e.clientX, y: e.clientY, nodeId: node.id })
      }
    },
    [toGraphCoords, nodeSizeMultiplier]
  )

  // -------------------------------------------------------------------------
  // Minimap pan handler
  // -------------------------------------------------------------------------

  const handleMinimapPan = useCallback((graphX: number, graphY: number) => {
    const canvas = canvasRef.current
    const zb = zoomBehaviorRef.current
    if (!canvas || !zb) return
    const t = transformRef.current
    const dpr = window.devicePixelRatio
    const canvasW = canvas.width / dpr
    const canvasH = canvas.height / dpr
    const newX = canvasW / 2 - graphX * t.k
    const newY = canvasH / 2 - graphY * t.k
    const newTransform = zoomIdentity.translate(newX, newY).scale(t.k)
    select(canvas).call(zb.transform, newTransform)
  }, [])

  // -------------------------------------------------------------------------
  // Resize observer
  // -------------------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const dpr = window.devicePixelRatio
      const w = entry.contentRect.width
      const h = entry.contentRect.height
      canvas.width = w * dpr
      canvas.height = h * dpr
      // Use ref to avoid re-creating this observer on render changes
      renderRef.current()
    })
    observer.observe(canvas)
    return () => observer.disconnect()
    // Intentionally stable — uses renderRef, not render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // -------------------------------------------------------------------------
  // Minimap: highlighted node IDs (focal + neighbors during hover)
  // -------------------------------------------------------------------------

  const highlightedNodeIds = useMemo<ReadonlySet<string>>(() => {
    return highlightHook.state.mode !== 'idle' ? highlightHook.state.connectedSet : new Set()
  }, [highlightHook.state])

  // -------------------------------------------------------------------------
  // JSX
  // -------------------------------------------------------------------------

  const isEmpty = !graph.nodes.length

  return (
    <div
      data-testid="graph-canvas"
      className="h-full relative focus-ring"
      tabIndex={0}
      style={{ backgroundColor: GRAPH_PALETTE.canvasBg }}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      />

      {isEmpty && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>
            No notes yet. Create one to see the graph.
          </p>
        </div>
      )}

      {/* Floating tooltip */}
      {tooltip && !isDraggingRef.current && (
        <div
          className="absolute pointer-events-none z-30"
          style={{
            left: tooltip.x + 12,
            top: tooltip.y - 8,
            backgroundColor: 'rgba(20, 20, 30, 0.92)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: 6,
            padding: '6px 10px',
            maxWidth: 240
          }}
        >
          <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: 12, fontWeight: 500 }}>
            {tooltip.label}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 2 }}>
            {tooltip.connectionCount} connection{tooltip.connectionCount !== 1 ? 's' : ''}
          </div>
        </div>
      )}

      {showMinimap && !isEmpty && (
        <GraphMinimap
          nodes={nodesRef.current ?? []}
          edges={edgesRef.current ?? []}
          transform={transformRef.current}
          canvasWidth={
            canvasRef.current?.width ? canvasRef.current.width / window.devicePixelRatio : 800
          }
          canvasHeight={
            canvasRef.current?.height ? canvasRef.current.height / window.devicePixelRatio : 600
          }
          highlightedNodeIds={highlightedNodeIds}
          onPan={handleMinimapPan}
        />
      )}

      {contextMenu && (
        <GraphContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          nodeId={contextMenu.nodeId}
          onClose={() => setContextMenu(null)}
          onOpenInEditor={(id) => {
            onNodeClick(id)
            setContextMenu(null)
          }}
        />
      )}

      <GraphSettingsPanel isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Gear icon — top-right, matches Obsidian */}
      <button
        type="button"
        onClick={() => setSettingsOpen((prev) => !prev)}
        className="absolute top-3 right-3 z-10 flex items-center justify-center w-7 h-7 rounded transition-colors duration-150 focus:outline-none"
        style={{
          backgroundColor: settingsOpen ? 'rgba(124, 92, 191, 0.2)' : 'rgba(255, 255, 255, 0.05)',
          color: settingsOpen ? '#7c5cbf' : 'rgba(255, 255, 255, 0.4)',
          border: '1px solid rgba(255, 255, 255, 0.08)'
        }}
        aria-label="Toggle graph settings"
        title="Graph Settings"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M13.3 6.5a1 1 0 0 0 .2-1.1l-.9-1.6a1 1 0 0 0-1-.5l-1.1.2a5 5 0 0 0-.9-.5l-.3-1.1A1 1 0 0 0 8.3 1h-1.6a1 1 0 0 0-1 .9L5.5 3a5 5 0 0 0-.9.5l-1.1-.2a1 1 0 0 0-1 .5L1.6 5.4a1 1 0 0 0 .2 1.1l.8.8v.6l-.8.8a1 1 0 0 0-.2 1.1l.9 1.6a1 1 0 0 0 1 .5l1.1-.2c.3.2.6.4.9.5l.3 1.1a1 1 0 0 0 1 .7h1.6a1 1 0 0 0 1-.9l.2-1.1c.3-.1.6-.3.9-.5l1.1.2a1 1 0 0 0 1-.5l.9-1.6a1 1 0 0 0-.2-1.1l-.8-.8V7.3l.8-.8Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  )
}
