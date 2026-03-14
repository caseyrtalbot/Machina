import { useRef, useEffect, useCallback, useState, useMemo } from 'react'
import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom'
import { select } from 'd3-selection'
import { useVaultStore } from '../../store/vault-store'
import { useGraphStore } from '../../store/graph-store'
import { useGraphSettingsStore } from '../../store/graph-settings-store'
import {
  createSimulation,
  renderGraph,
  findNodeAt,
  type SimNode,
  type SimEdge,
  type NodeSizeConfig,
  type SimulationConfig
} from './GraphRenderer'
import { useGraphHighlight } from './useGraphHighlight'
import { useGraphAnimation } from './useGraphAnimation'
import { useGraphKeyboard } from './useGraphKeyboard'
import { GraphMinimap } from './GraphMinimap'
import { GraphContextMenu } from './GraphContextMenu'
import { GraphSettingsPanel } from './GraphSettingsPanel'
import { colors } from '../../design/tokens'

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
// GraphPanel
// ---------------------------------------------------------------------------

interface GraphPanelProps {
  onNodeClick: (id: string) => void
}

export function GraphPanel({ onNodeClick }: GraphPanelProps) {
  // Canvas and simulation refs
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const simRef = useRef<ReturnType<typeof createSimulation> | null>(null)
  const nodesRef = useRef<SimNode[] | null>(null)
  const edgesRef = useRef<SimEdge[] | null>(null)
  const transformRef = useRef({ x: 0, y: 0, k: 1 })
  const zoomBehaviorRef = useRef<ZoomBehavior<HTMLCanvasElement, unknown> | null>(null)
  const prevNodesRef = useRef<SimNode[]>([])
  const skipSpritesRef = useRef(false)
  const rafIdRef = useRef<number | null>(null)
  const renderRef = useRef<() => void>(() => {})

  // Store selectors (all narrow to avoid unnecessary re-renders)
  const graph = useVaultStore((s) => s.graph)
  const fileToId = useVaultStore((s) => s.fileToId)
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId)
  const hoveredNodeId = useGraphStore((s) => s.hoveredNodeId)
  const setSelectedNode = useGraphStore((s) => s.setSelectedNode)
  const setContentView = useGraphStore((s) => s.setContentView)

  const showOrphans = useGraphSettingsStore((s) => s.showOrphans)
  const showExistingOnly = useGraphSettingsStore((s) => s.showExistingOnly)
  const showTags = useGraphSettingsStore((s) => s.showTags)
  const baseNodeSize = useGraphSettingsStore((s) => s.baseNodeSize)
  const nodeSizeMode = useGraphSettingsStore((s) => s.nodeSizeMode)
  const isAnimating = useGraphSettingsStore((s) => s.isAnimating)
  const showMinimap = useGraphSettingsStore((s) => s.showMinimap)
  const linkOpacity = useGraphSettingsStore((s) => s.linkOpacity)
  const linkThickness = useGraphSettingsStore((s) => s.linkThickness)
  const textFadeThreshold = useGraphSettingsStore((s) => s.textFadeThreshold)
  const showArrows = useGraphSettingsStore((s) => s.showArrows)
  const centerForce = useGraphSettingsStore((s) => s.centerForce)
  const repelForce = useGraphSettingsStore((s) => s.repelForce)
  const linkForceStrength = useGraphSettingsStore((s) => s.linkForce)
  const linkDistance = useGraphSettingsStore((s) => s.linkDistance)
  const groups = useGraphSettingsStore((s) => s.groups)

  // Derived state
  const sizeConfig = useMemo<NodeSizeConfig>(
    () => ({ mode: nodeSizeMode, baseSize: baseNodeSize }),
    [nodeSizeMode, baseNodeSize]
  )
  const [isFocused, setIsFocused] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    nodeId: string
  } | null>(null)
  const reducedMotion = useReducedMotion()

  // Simulation reheat handler (must be declared before hooks that depend on it)
  const handleSimRestart = useCallback((alpha: number) => {
    simRef.current?.alpha(alpha).restart()
  }, [])

  // Integration hooks
  const highlightHook = useGraphHighlight(edgesRef.current ?? [])
  const animation = useGraphAnimation(handleSimRestart, reducedMotion)

  // Positioned nodes for keyboard navigation (only nodes with resolved coordinates)
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

    const t = transformRef.current
    const dpr = window.devicePixelRatio
    const w = canvas.width / dpr
    const h = canvas.height / dpr

    ctx.save()
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    // Background fill in screen-space (before transform)
    ctx.scale(dpr, dpr)
    ctx.fillStyle = colors.bg.base
    ctx.fillRect(0, 0, w, h)
    ctx.translate(t.x, t.y)
    ctx.scale(t.k, t.k)

    const frameDuration = renderGraph(ctx, nodes, edges, w, h, selectedNodeId, hoveredNodeId, {
      highlight: highlightHook.state,
      sizeConfig,
      transform: t,
      canvasWidth: w,
      canvasHeight: h,
      reducedMotion,
      skipAmbientSprites: skipSpritesRef.current,
      linkOpacity,
      linkThickness,
      textFadeThreshold,
      showArrows
    })

    ctx.restore()

    // Adaptive quality: skip ambient sprites if last frame exceeded budget
    skipSpritesRef.current = frameDuration > 16

    // Continue render loop while animations are active
    if (animation.hasActiveAnimations()) {
      rafIdRef.current = requestAnimationFrame(render)
    }
  }, [
    selectedNodeId,
    hoveredNodeId,
    sizeConfig,
    reducedMotion,
    highlightHook.state,
    animation,
    linkOpacity,
    linkThickness,
    textFadeThreshold,
    showArrows
  ])

  // Keep renderRef in sync so simulation tick uses the latest render without recreating sim
  useEffect(() => {
    renderRef.current = render
  }, [render])

  // Re-render on display-only settings changes (no sim recreation needed)
  useEffect(() => {
    renderRef.current()
  }, [linkOpacity, linkThickness, textFadeThreshold, showArrows, sizeConfig])

  // -------------------------------------------------------------------------
  // Graph data pipeline: filter, diff, simulate
  // -------------------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Build set of existing node IDs from fileToId mapping
    const existingNodeIds = new Set(Object.values(fileToId))

    // Start with all nodes, preserving existing positions when possible
    const prevNodeMap = new Map(prevNodesRef.current.map((n) => [n.id, n]))
    let filteredNodes = graph.nodes.map((n) => {
      const prev = prevNodeMap.get(n.id)
      return {
        ...n,
        x: prev?.x ?? Math.random() * canvas.clientWidth,
        y: prev?.y ?? Math.random() * canvas.clientHeight
      }
    }) as SimNode[]

    let filteredEdges: SimEdge[] = graph.edges.map((e) => ({ ...e }))

    // Filter out nodes whose group visibility is false
    filteredNodes = filteredNodes.filter((n) => {
      const groupCfg = groups[n.type]
      return groupCfg ? groupCfg.visible : true
    })

    // Filter out tag nodes when showTags is false
    if (!showTags) {
      filteredNodes = filteredNodes.filter((n) => n.type !== 'tag')
    }

    // showExistingOnly: keep only nodes that map to a real vault file
    if (showExistingOnly) {
      filteredNodes = filteredNodes.filter((n) => existingNodeIds.has(n.id))
    }

    // showOrphans: if false, keep only nodes that appear in at least one edge
    if (!showOrphans) {
      const connectedIds = new Set<string>()
      for (const edge of filteredEdges) {
        const srcId = typeof edge.source === 'string' ? edge.source : edge.source.id
        const tgtId = typeof edge.target === 'string' ? edge.target : edge.target.id
        connectedIds.add(srcId)
        connectedIds.add(tgtId)
      }
      filteredNodes = filteredNodes.filter((n) => connectedIds.has(n.id))
    }

    // Filter edges to only those connecting remaining nodes
    const nodeIdSet = new Set(filteredNodes.map((n) => n.id))
    filteredEdges = filteredEdges.filter((e) => {
      const srcId = typeof e.source === 'string' ? e.source : e.source.id
      const tgtId = typeof e.target === 'string' ? e.target : e.target.id
      return nodeIdSet.has(srcId) && nodeIdSet.has(tgtId)
    })

    // Diff against previous nodes for enter/exit animations
    const diff = animation.diffNodes(prevNodesRef.current, filteredNodes)
    animation.detectRenames(diff.removed, diff.added)

    // Update refs
    nodesRef.current = filteredNodes
    edgesRef.current = filteredEdges
    prevNodesRef.current = filteredNodes

    // Queue enter/exit animations
    if (diff.added.length > 0) {
      animation.queueEnter(diff.added as SimNode[])
    }
    if (diff.removed.length > 0) {
      animation.queueExit(diff.removed as SimNode[])
    }

    let sim: ReturnType<typeof createSimulation> | null = null

    if (filteredNodes.length > 0) {
      const simConfig: SimulationConfig = {
        centerForce,
        repelForce,
        linkForce: linkForceStrength,
        linkDistance
      }

      sim = createSimulation(
        filteredNodes,
        filteredEdges,
        canvas.clientWidth,
        canvas.clientHeight,
        simConfig
      )

      if (!isAnimating) {
        sim.stop()
      }

      sim.on('tick', () => {
        nodesRef.current = filteredNodes
        edgesRef.current = filteredEdges
        renderRef.current()
      })

      simRef.current = sim
    } else {
      renderRef.current()
    }

    return () => {
      sim?.stop()
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
    }
    // render excluded intentionally — accessed via renderRef to avoid sim recreation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    graph,
    fileToId,
    showOrphans,
    showExistingOnly,
    showTags,
    groups,
    centerForce,
    repelForce,
    linkForceStrength,
    linkDistance,
    isAnimating,
    animation
  ])

  // -------------------------------------------------------------------------
  // Zoom setup
  // -------------------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const zb = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        transformRef.current = event.transform
        render()
      })

    select(canvas).call(zb)
    zoomBehaviorRef.current = zb

    return () => {
      select(canvas).on('.zoom', null)
    }
  }, [render])

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
  // Mouse event handlers
  // -------------------------------------------------------------------------

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const coords = toGraphCoords(e.clientX, e.clientY)
      if (!coords) return
      const node = findNodeAt(nodesRef.current ?? [], coords.x, coords.y)
      highlightHook.handleHover(node?.id ?? null)
      const canvas = canvasRef.current
      if (canvas) canvas.style.cursor = node ? 'pointer' : 'default'
    },
    [toGraphCoords, highlightHook]
  )

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      setContextMenu(null)
      const coords = toGraphCoords(e.clientX, e.clientY)
      if (!coords) return
      const node = findNodeAt(nodesRef.current ?? [], coords.x, coords.y)
      if (node) {
        highlightHook.handleClick(node.id)
        onNodeClick(node.id)
      } else {
        highlightHook.handleClick(null)
      }
    },
    [toGraphCoords, highlightHook, onNodeClick]
  )

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const coords = toGraphCoords(e.clientX, e.clientY)
      if (!coords) return
      const node = findNodeAt(nodesRef.current ?? [], coords.x, coords.y)
      if (node) {
        highlightHook.handleDoubleClick(node.id)
        setContentView('editor')
        onNodeClick(node.id)
      }
    },
    [toGraphCoords, highlightHook, setContentView, onNodeClick]
  )

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      e.preventDefault()
      const coords = toGraphCoords(e.clientX, e.clientY)
      if (!coords) return
      const node = findNodeAt(nodesRef.current ?? [], coords.x, coords.y)
      if (node) {
        setContextMenu({ x: e.clientX, y: e.clientY, nodeId: node.id })
      }
    },
    [toGraphCoords]
  )

  // -------------------------------------------------------------------------
  // Minimap pan handler (no d3-transition, direct transform application)
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
  // Resize observer: keep canvas dimensions in sync with layout
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
      render()
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [render])

  // -------------------------------------------------------------------------
  // JSX
  // -------------------------------------------------------------------------

  const isEmpty = !graph.nodes.length

  return (
    <div
      data-testid="graph-canvas"
      className="h-full relative focus-ring"
      tabIndex={0}
      style={{ backgroundColor: colors.bg.base }}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        onMouseMove={handleMouseMove}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      />

      {isEmpty && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-sm" style={{ color: colors.text.muted }}>
            No notes yet. Create one to see the graph.
          </p>
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

      <button
        type="button"
        onClick={() => setSettingsOpen((prev) => !prev)}
        className="absolute top-3 right-3 z-10 flex items-center justify-center w-7 h-7 rounded transition-colors duration-150 focus:outline-none"
        style={{
          backgroundColor: settingsOpen ? colors.accent.muted : colors.bg.elevated,
          color: settingsOpen ? colors.accent.default : colors.text.muted,
          border: '1px solid var(--border-subtle)'
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
