import { useState, useEffect, useRef, useCallback } from 'react'
import { useVaultStore } from '@renderer/store/vault-store'
import { useGraphViewStore } from '@renderer/store/graph-view-store'
import { useEnrichmentRunStore } from '@renderer/store/enrichment-run-store'
import { useSettingsStore } from '@renderer/store/settings-store'
import { useUiStore } from '@renderer/store/ui-store'
import { GraphRenderer } from './graph-renderer'
import { LabelLayer } from './graph-label-layer'
import { GraphSettingsPanel } from './GraphSettingsPanel'
import { EnrichmentPill } from './EnrichmentPill'
import { selectEnrichmentTargets } from './enrichment-targets'
import { getGraphLod } from './graph-lod'
import { resolveFocusIdx } from './graph-focus'
import { colors, floatingPanel, typography } from '@renderer/design/tokens'
import { useReducedMotion } from '@renderer/hooks/useReducedMotion'
import { openArtifactInEditor } from '@renderer/system-artifacts/system-artifact-runtime'
import type { SimNode, PhysicsCommand, PhysicsResult, ForceParams } from './graph-types'
import type { KnowledgeGraph } from '@shared/types'

const FIT_PADDING_PX = 80
const MAX_AUTO_FIT_SCALE = 2

/** Compute a viewport that fits all nodes with padding. */
function fitAllNodes(renderer: GraphRenderer, container: HTMLElement): void {
  const positions = renderer.getPositions()
  const nodes = renderer.getNodes()
  if (nodes.length === 0 || positions.length === 0) return

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (let i = 0; i < nodes.length; i++) {
    const x = positions[i * 2]
    const y = positions[i * 2 + 1]
    if (x === undefined || y === undefined) continue
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }

  if (!isFinite(minX)) return

  const boxWidth = maxX - minX + FIT_PADDING_PX * 2
  const boxHeight = maxY - minY + FIT_PADDING_PX * 2
  const containerWidth = container.clientWidth
  const containerHeight = container.clientHeight

  const scale = Math.min(containerWidth / boxWidth, containerHeight / boxHeight, MAX_AUTO_FIT_SCALE)
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2

  renderer.setViewport({
    x: -centerX * scale,
    y: -centerY * scale,
    scale
  })
}

/**
 * Convert KnowledgeGraph data into worker-compatible format.
 * Dismissed ghost nodes (and their edges) are excluded so the graph
 * agrees with the ghost panel's dismissal state.
 */
// eslint-disable-next-line react-refresh/only-export-components -- pure helper exported for tests
export function prepareSimData(graph: KnowledgeGraph, dismissedGhosts: ReadonlySet<string>) {
  const nodeIndexMap = new Map<string, number>()
  const simNodes: SimNode[] = []
  for (const n of graph.nodes) {
    const isGhost = !n.origin
    if (isGhost && dismissedGhosts.has(n.id)) continue
    const index = simNodes.length
    nodeIndexMap.set(n.id, index)
    simNodes.push({
      index,
      id: n.id,
      title: n.title,
      type: n.type,
      signal: n.signal,
      connectionCount: n.connectionCount,
      origin: n.origin,
      isGhost
    })
  }

  const simEdges = graph.edges
    .map((e) => {
      const si = nodeIndexMap.get(e.source)
      const ti = nodeIndexMap.get(e.target)
      if (si === undefined || ti === undefined) return null
      return { source: si, target: ti, kind: e.kind }
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)

  return { simNodes, simEdges, nodeIndexMap }
}

function GraphEmptyState({
  artifactCount,
  rawFileCount
}: {
  readonly artifactCount: number
  readonly rawFileCount: number
}) {
  const title =
    artifactCount === 0
      ? 'No notes are available to graph yet.'
      : rawFileCount > 0
        ? 'Graph is waiting on relationship data.'
        : 'No relationships were found for this vault yet.'

  // Honest guidance only: point at affordances that exist today
  // (tags/wikilinks or an agent thread). Once the graph has nodes, the
  // EnrichmentPill offers the one-click agent pass.
  const description =
    artifactCount === 0
      ? 'Open a vault with markdown notes to populate the graph view.'
      : rawFileCount > 0
        ? `${rawFileCount} file${rawFileCount === 1 ? ' has' : 's have'} no metadata or discovered connections yet. Add tags or [[wikilinks]], or ask the agent in a thread to connect them.`
        : 'Add links, tags, tensions, or generated metadata so the graph has nodes to render.'

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center p-6 pointer-events-none">
      <div
        className="max-w-md px-5 py-4 text-center"
        style={{
          backgroundColor: floatingPanel.glass.bg,
          backdropFilter: floatingPanel.glass.blur,
          border: '1px solid var(--color-border-default)',
          boxShadow: floatingPanel.shadow
        }}
      >
        <div
          className="text-[10px] uppercase tracking-[0.18em] mb-2"
          style={{ color: 'var(--color-text-muted)', fontFamily: typography.fontFamily.mono }}
        >
          Graph View
        </div>
        <h2 className="text-base font-medium mb-2" style={{ color: 'var(--color-text-primary)' }}>
          {title}
        </h2>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
          {description}
        </p>
      </div>
    </div>
  )
}

function GraphStatusRail({
  nodeCount,
  edgeCount
}: {
  readonly nodeCount: number
  readonly edgeCount: number
}) {
  const tutorialDismissed = useUiStore((s) => s.graphTutorialDismissed)
  const dismissGraphTutorial = useUiStore((s) => s.dismissGraphTutorial)

  return (
    <div className="absolute top-3 left-3 z-20 flex flex-wrap items-center gap-2 pointer-events-none">
      <div
        className="px-3 py-1.5 text-xs font-mono"
        style={{
          backgroundColor: floatingPanel.glass.bg,
          backdropFilter: floatingPanel.glass.blur,
          border: '1px solid var(--line-subtle)',
          color: colors.text.secondary
        }}
      >
        {nodeCount} nodes
        <span style={{ opacity: 0.3, margin: '0 8px' }}>|</span>
        {edgeCount} edges
      </div>
      {!tutorialDismissed && (
        <div
          className="flex items-center gap-2 px-3 py-1.5 text-xs pointer-events-auto"
          style={{
            backgroundColor: floatingPanel.glass.bg,
            backdropFilter: floatingPanel.glass.blur,
            border: '1px solid var(--line-faint)',
            color: colors.text.muted
          }}
        >
          Hover to isolate neighborhoods. Drag to compare clusters.
          <button
            type="button"
            onClick={dismissGraphTutorial}
            className="cursor-pointer leading-none"
            style={{ color: colors.text.muted, padding: '0 2px' }}
            title="Dismiss tip"
            aria-label="Dismiss tip"
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}

export function GraphPanel() {
  const reducedMotion = useReducedMotion()
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<GraphRenderer | null>(null)
  const labelLayerRef = useRef<LabelLayer | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const simNodesRef = useRef<SimNode[]>([])
  const positionsRef = useRef<Float32Array>(new Float32Array(0))
  const nodeIndexMapRef = useRef<Map<string, number>>(new Map())
  const edgesRef = useRef<Array<{ source: number; target: number }>>([])
  const mountedRef = useRef(false)
  const hasAutoFitRef = useRef(false)
  // Selection ids the renderer itself produced (click/deselect) — the
  // store-sync effect skips centering for these so in-graph clicks don't pan.
  const rendererSelectionRef = useRef<string | null>(null)

  const graph = useVaultStore((s) => s.graph)
  const artifactCount = useVaultStore((s) => s.artifacts.length)
  const rawFileCount = useVaultStore((s) => {
    if (s.artifacts.length === 0 || !s.vaultPath) return 0
    return selectEnrichmentTargets(s.artifacts, s.artifactPathById, s.vaultPath).length
  })
  // A successful enrichment pass drains the backlog to 0 — keep the pill
  // mounted while a run is active or just finished so its progress/"finished"
  // states stay visible instead of vanishing with the count.
  const enrichmentActive = useEnrichmentRunStore((s) => s.starting || s.threadId !== null)

  const setHoveredNode = useGraphViewStore((s) => s.setHoveredNode)
  const setSelectedNode = useGraphViewStore((s) => s.setSelectedNode)
  const setSimulationState = useGraphViewStore((s) => s.setSimulationState)
  const setViewportStore = useGraphViewStore((s) => s.setViewport)
  const setGraphStats = useGraphViewStore((s) => s.setGraphStats)

  // Helper: get neighbor indices from cached edges
  const getNeighborSet = useCallback((nodeIndex: number): Set<number> => {
    const neighbors = new Set<number>([nodeIndex])
    for (const edge of edgesRef.current) {
      if (edge.source === nodeIndex) neighbors.add(edge.target)
      if (edge.target === nodeIndex) neighbors.add(edge.source)
    }
    return neighbors
  }, [])

  /** Resolve the effective focus node index: hover takes priority, falls back to selection. */
  const getFocusIdx = useCallback((): number | null => {
    return resolveFocusIdx(nodeIndexMapRef.current)
  }, [])

  // Mount renderer + worker once
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    mountedRef.current = true

    const renderer = new GraphRenderer({
      onNodeHover: (idx) => {
        if (!mountedRef.current) return
        const id = idx !== null ? (simNodesRef.current[idx]?.id ?? null) : null
        setHoveredNode(id)
        renderer.setHighlightedNode(idx)
      },
      onNodeClick: (idx) => {
        if (!mountedRef.current) return
        const node = simNodesRef.current[idx]
        if (!node) return

        // Toggle selection: clicking the same node again deselects
        const currentSelected = useGraphViewStore.getState().selectedNodeId
        const nextId = currentSelected === node.id ? null : node.id
        rendererSelectionRef.current = nextId
        setSelectedNode(nextId)
        renderer.setSelectedNode(nextId !== null ? idx : null)
      },
      onNodeOpen: (idx) => {
        if (!mountedRef.current) return
        const node = simNodesRef.current[idx]
        if (!node) return
        const path = useVaultStore.getState().artifactPathById[node.id]
        if (path) openArtifactInEditor(path, node.title)
      },
      onDeselect: () => {
        if (!mountedRef.current) return
        rendererSelectionRef.current = null
        setSelectedNode(null)
        renderer.setSelectedNode(null)
      },
      onNodeDrag: (idx, x, y) => {
        if (!workerRef.current) return
        const cmd: PhysicsCommand = { type: 'drag', nodeIndex: idx, x, y }
        workerRef.current.postMessage(cmd)
      },
      onNodeDragEnd: (idx) => {
        if (!workerRef.current) return
        const cmd: PhysicsCommand = { type: 'drag-end', nodeIndex: idx }
        workerRef.current.postMessage(cmd)
      },
      onViewportChange: (vp) => {
        if (!mountedRef.current) return
        setViewportStore(vp)

        // Re-render labels on viewport change (zoom/pan)
        const ll = labelLayerRef.current
        if (ll && positionsRef.current.length > 0) {
          const lod = getGraphLod(vp.scale)
          const focusIdx = getFocusIdx()
          const ns = focusIdx !== null ? getNeighborSet(focusIdx) : null
          const { showLabels, labelScale } = useGraphViewStore.getState()
          ll.render(
            simNodesRef.current,
            positionsRef.current,
            vp,
            lod,
            focusIdx,
            ns,
            showLabels,
            labelScale,
            useSettingsStore.getState().nodeBrightness
          )
        }
      }
    })

    renderer.mount(container)
    rendererRef.current = renderer

    const labelLayer = new LabelLayer()
    labelLayer.mount(container)
    labelLayerRef.current = labelLayer

    // Spawn physics worker
    const worker = new Worker(new URL('../../engine/graph-physics-worker.ts', import.meta.url), {
      type: 'module'
    })

    worker.onerror = (e) => {
      console.error('[GraphPanel] physics worker error:', e)
    }

    worker.onmessage = (e: MessageEvent<PhysicsResult>) => {
      if (!mountedRef.current) return
      const msg = e.data

      if (msg.type === 'positions') {
        positionsRef.current = msg.buffer
        renderer.setPositions(msg.buffer)
        setSimulationState(msg.alpha, msg.settled)

        // Auto-fit viewport once when layout stabilizes
        if (!hasAutoFitRef.current && msg.alpha < 0.5 && renderer.getNodeCount() > 0) {
          hasAutoFitRef.current = true
          fitAllNodes(renderer, container)
        }

        // Update label layer
        const vp = useGraphViewStore.getState().viewport
        const lod = getGraphLod(vp.scale)
        const focusIdx = getFocusIdx()
        const neighborSet = focusIdx !== null ? getNeighborSet(focusIdx) : null

        const { showLabels, labelScale } = useGraphViewStore.getState()
        labelLayer.render(
          simNodesRef.current,
          msg.buffer,
          vp,
          lod,
          focusIdx,
          neighborSet,
          showLabels,
          labelScale,
          useSettingsStore.getState().nodeBrightness
        )
      }
    }

    workerRef.current = worker

    // Resize observer for label layer
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        const { width, height } = entry.contentRect
        labelLayer.resize(width, height)
      }
    })
    resizeObserver.observe(container)

    return () => {
      mountedRef.current = false
      resizeObserver.disconnect()
      renderer.destroy()
      labelLayer.destroy()
      worker.terminate()
      rendererRef.current = null
      labelLayerRef.current = null
      workerRef.current = null
      useGraphViewStore.getState().reset()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- Mount once

  // Send graph data to worker when it changes.
  // The physics worker preserves existing node positions across re-inits,
  // so spurious graph ref changes (e.g., vault re-parse after editor flush)
  // won't cause visual spasms.
  const dismissedGhosts = useUiStore((s) => s.dismissedGhosts)
  const prevTopologyRef = useRef({ nodeCount: 0, edgeCount: 0 })
  useEffect(() => {
    if (!workerRef.current || graph.nodes.length === 0) return

    const { simNodes, simEdges, nodeIndexMap } = prepareSimData(graph, new Set(dismissedGhosts))
    simNodesRef.current = simNodes
    nodeIndexMapRef.current = nodeIndexMap
    edgesRef.current = simEdges

    const renderer = rendererRef.current
    if (renderer) {
      renderer.setGraphData(
        simNodes,
        simEdges.map((e) => ({
          sourceIndex: e.source,
          targetIndex: e.target,
          kind: e.kind
        }))
      )
      // Rebuilding simNodes shifts indices (e.g. dismissing a ghost), so the
      // renderer's index-based selection must be remapped from the stable id.
      const selectedId = useGraphViewStore.getState().selectedNodeId
      renderer.setSelectedNode(selectedId !== null ? (nodeIndexMap.get(selectedId) ?? null) : null)
    }

    setGraphStats(simNodes.length, simEdges.length)

    // Only reset auto-fit when topology actually changed (not just a new ref)
    const prev = prevTopologyRef.current
    if (simNodes.length !== prev.nodeCount || simEdges.length !== prev.edgeCount) {
      hasAutoFitRef.current = false
    }
    prevTopologyRef.current = { nodeCount: simNodes.length, edgeCount: simEdges.length }

    const cmd: PhysicsCommand = { type: 'init', nodes: simNodes, edges: simEdges }
    workerRef.current.postMessage(cmd)
  }, [graph, dismissedGhosts, setGraphStats])

  // Ghost panel → graph handoff: when selection is driven from outside the
  // renderer (e.g. "Show in graph"), sync the renderer and center the node.
  const selectedNodeId = useGraphViewStore((s) => s.selectedNodeId)
  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer) return
    const fromRenderer = selectedNodeId === rendererSelectionRef.current
    rendererSelectionRef.current = selectedNodeId
    if (fromRenderer) return

    const idx =
      selectedNodeId !== null ? (nodeIndexMapRef.current.get(selectedNodeId) ?? null) : null
    renderer.setSelectedNode(idx)
    if (idx !== null) renderer.centerOnNode(idx)
  }, [selectedNodeId])

  // Reactively apply display options to the renderer
  const showEdges = useGraphViewStore((s) => s.showEdges)
  const showGhostNodes = useGraphViewStore((s) => s.showGhostNodes)
  const showOrphanNodes = useGraphViewStore((s) => s.showOrphanNodes)
  const nodeScale = useGraphViewStore((s) => s.nodeScale)

  const showLabels = useGraphViewStore((s) => s.showLabels)
  const labelScale = useGraphViewStore((s) => s.labelScale)

  const edgeBrightness = useSettingsStore((s) => s.edgeBrightness)
  const nodeBrightness = useSettingsStore((s) => s.nodeBrightness)

  useEffect(() => {
    rendererRef.current?.setDisplayOptions({
      showEdges,
      showGhostNodes,
      showOrphanNodes,
      nodeScale,
      edgeBrightness,
      nodeBrightness
    })

    // Re-render labels immediately when display settings change
    const ll = labelLayerRef.current
    if (ll && positionsRef.current.length > 0) {
      const vp = useGraphViewStore.getState().viewport
      const lod = getGraphLod(vp.scale)
      const focusIdx = getFocusIdx()
      const ns = focusIdx !== null ? getNeighborSet(focusIdx) : null
      ll.render(
        simNodesRef.current,
        positionsRef.current,
        vp,
        lod,
        focusIdx,
        ns,
        showLabels,
        labelScale,
        nodeBrightness
      )
    }
  }, [
    showEdges,
    showGhostNodes,
    showOrphanNodes,
    nodeScale,
    showLabels,
    labelScale,
    edgeBrightness,
    nodeBrightness,
    getNeighborSet,
    getFocusIdx
  ])

  // Settings panel toggle
  const [showSettings, setShowSettings] = useState(false)

  // Send force param changes to worker
  const handleForceParamsChange = useCallback((params: Partial<ForceParams>) => {
    if (!workerRef.current) return
    const cmd: PhysicsCommand = { type: 'update-params', params }
    workerRef.current.postMessage(cmd)
  }, [])

  // Reheat the simulation (skip when user prefers reduced motion — the settling
  // tween is the whole point of reheat; stop instead to flatten it.)
  const handleReheat = useCallback(() => {
    if (!workerRef.current) return
    const cmd: PhysicsCommand = reducedMotion ? { type: 'stop' } : { type: 'reheat', alpha: 0.5 }
    workerRef.current.postMessage(cmd)
  }, [reducedMotion])

  // Fit all nodes into view
  const handleFitAll = useCallback(() => {
    const renderer = rendererRef.current
    const container = containerRef.current
    if (!renderer || !container) return
    fitAllNodes(renderer, container)
  }, [])

  // Subscribe to viewport for zoom indicator
  const viewportScale = useGraphViewStore((s) => s.viewport.scale)
  const zoomPercent = Math.round(viewportScale * 100)
  const isGraphEmpty = graph.nodes.length === 0

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden"
      style={{ background: 'var(--color-bg-base)' }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at 50% 40%, color-mix(in srgb, var(--color-accent-default) 8%, transparent), transparent 32%), linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent 28%, transparent 72%, rgba(255, 255, 255, 0.03))'
        }}
      />

      {isGraphEmpty && (
        <GraphEmptyState artifactCount={artifactCount} rawFileCount={rawFileCount} />
      )}

      {!isGraphEmpty && (
        <GraphStatusRail nodeCount={graph.nodes.length} edgeCount={graph.edges.length} />
      )}

      {/* Enrichment pill: one-click native-agent pass over unconnected files (3.9) */}
      {(rawFileCount > 0 || enrichmentActive) && !isGraphEmpty && (
        <EnrichmentPill rawFileCount={rawFileCount} />
      )}

      {/* Settings toggle button */}
      <button
        type="button"
        onClick={() => setShowSettings((prev) => !prev)}
        className="absolute top-3 right-3 z-20 flex items-center justify-center transition-all"
        style={{
          width: 32,
          height: 32,
          backgroundColor: showSettings ? 'var(--color-accent-default)' : floatingPanel.glass.bg,
          border: '1px solid var(--line-subtle)',
          color: showSettings ? 'var(--color-accent-fg)' : 'var(--color-text-secondary)',
          backdropFilter: floatingPanel.glass.blur,
          boxShadow: floatingPanel.shadowCompact
        }}
        title="Graph settings"
        aria-label="Graph settings"
        aria-expanded={showSettings}
      >
        <svg
          width={16}
          height={16}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>

      {/* Collapsible settings panel */}
      {showSettings && (
        <GraphSettingsPanel onForceParamsChange={handleForceParamsChange} onReheat={handleReheat} />
      )}

      {/* Bottom-left controls: Fit All + zoom indicator */}
      {!isGraphEmpty && (
        <div className="absolute bottom-3 left-3 z-20 flex items-center gap-2">
          <button
            type="button"
            onClick={handleFitAll}
            className="text-xs px-3 py-1.5 transition-all cursor-pointer"
            style={{
              backgroundColor: floatingPanel.glass.bg,
              backdropFilter: floatingPanel.glass.blur,
              border: '1px solid var(--line-subtle)',
              color: 'var(--color-text-secondary)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--color-accent-default)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--color-border-default)'
            }}
            title="Fit all nodes in view"
          >
            Fit All
          </button>
          <span
            className="text-xs tabular-nums font-mono px-2 py-1.5"
            style={{
              backgroundColor: floatingPanel.glass.bg,
              backdropFilter: floatingPanel.glass.blur,
              border: '1px solid var(--line-subtle)',
              color: 'var(--color-text-muted)',
              fontSize: 10,
              minWidth: 44,
              textAlign: 'center'
            }}
          >
            {zoomPercent}%
          </span>
        </div>
      )}
    </div>
  )
}
