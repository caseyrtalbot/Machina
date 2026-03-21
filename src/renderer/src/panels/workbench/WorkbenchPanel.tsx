import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CanvasSurface } from '../canvas/CanvasSurface'
import { useCanvasStore } from '../../store/canvas-store'
import { useWorkbenchStore } from '../../store/workbench-store'
import { LazyCards } from '../canvas/card-registry'
import { CardShellSkeleton } from '../canvas/CardShellSkeleton'
import { CardLodPreview } from '../canvas/CardLodPreview'
import { EdgeLayer } from '../canvas/EdgeLayer'
import { CanvasMinimap } from '../canvas/CanvasMinimap'
import { useViewportCulling } from '../canvas/use-canvas-culling'
import { getLodLevel } from '../canvas/use-canvas-lod'
import { useVaultStore } from '../../store/vault-store'
import { layoutWorkbench } from './workbench-layout'
import { saveCanvas, serializeCanvas } from '../canvas/canvas-io'
import { useProjectActivity } from '../../hooks/useProjectActivity'
import { useSessionThread } from '../../hooks/useSessionThread'
import { useTabStore } from '../../store/tab-store'
import { useWorkbenchActionStore } from '../../store/workbench-actions-store'
import { SessionThreadPanel } from './SessionThreadPanel'
import { colors, getArtifactColor, typography, floatingPanel } from '../../design/tokens'
import type { CanvasFile, CanvasNode } from '@shared/canvas-types'
import { createCanvasFile, createCanvasNode } from '@shared/canvas-types'
import {
  buildPatternArtifactDocument,
  buildSessionArtifactDocument,
  buildTensionArtifactDocument
} from './workbench-artifacts'
import {
  createAndOpenSystemArtifact,
  openArtifactInEditor
} from '../../system-artifacts/system-artifact-runtime'
import { migrateWorkbenchFile } from './workbench-migration'

const WORKBENCH_FILENAME = '.thought-engine-workbench.json'
const PROJECT_ROOT_MARKERS = ['.git', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod']
const MAX_WALK_UP = 5

/** Walk up from a path looking for project root markers (.git, package.json, etc). */
async function detectProjectRoot(startPath: string): Promise<string> {
  let current = startPath
  for (let i = 0; i < MAX_WALK_UP; i++) {
    for (const marker of PROJECT_ROOT_MARKERS) {
      const exists = await window.api.fs.fileExists(current + '/' + marker)
      if (exists) return current
    }
    const parent = current.replace(/\/[^/]+$/, '')
    if (parent === current) break
    current = parent
  }
  return startPath
}

function getWorkbenchPath(projectPath: string): string {
  return projectPath + '/' + WORKBENCH_FILENAME
}

function withAlpha(color: string, alphaSuffix: string, fallback: string): string {
  return color.startsWith('#') ? `${color}${alphaSuffix}` : fallback
}

function ToolbarDivider() {
  return <div className="w-px h-4" style={{ backgroundColor: colors.border.default }} />
}

function ToolbarStatusPill({ label, color }: { readonly label: string; readonly color: string }) {
  return (
    <span
      className="rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.08em]"
      style={{
        color,
        backgroundColor: withAlpha(color, '14', 'rgba(255, 255, 255, 0.05)'),
        border: `1px solid ${withAlpha(color, '24', 'rgba(255, 255, 255, 0.08)')}`
      }}
    >
      {label}
    </span>
  )
}

function ToolbarButton({
  label,
  title,
  onClick,
  disabled = false,
  tone = colors.text.secondary
}: {
  readonly label: string
  readonly title: string
  readonly onClick: () => void | Promise<void>
  readonly disabled?: boolean
  readonly tone?: string
}) {
  return (
    <button
      onClick={() => void onClick()}
      disabled={disabled}
      className="rounded-md px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed"
      style={{
        color: disabled ? colors.text.muted : tone,
        backgroundColor: disabled
          ? 'transparent'
          : withAlpha(tone, '14', 'rgba(255, 255, 255, 0.05)'),
        border: `1px solid ${
          disabled ? colors.border.default : withAlpha(tone, '24', 'rgba(255, 255, 255, 0.08)')
        }`
      }}
      title={title}
    >
      {label}
    </button>
  )
}

function centerOnNode(
  node: CanvasNode,
  container: { width: number; height: number },
  zoom = 1
): { x: number; y: number; zoom: number } {
  const cx = node.position.x + node.size.width / 2
  const cy = node.position.y + node.size.height / 2
  return {
    x: container.width / 2 - cx * zoom,
    y: container.height / 2 - cy * zoom,
    zoom
  }
}

function fitViewportToNodes(
  nodes: readonly CanvasNode[],
  container: { width: number; height: number }
): { x: number; y: number; zoom: number } {
  if (nodes.length === 0) return { x: 0, y: 0, zoom: 1 }

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.position.x)
    minY = Math.min(minY, n.position.y)
    maxX = Math.max(maxX, n.position.x + n.size.width)
    maxY = Math.max(maxY, n.position.y + n.size.height)
  }

  const contentW = maxX - minX
  const contentH = maxY - minY
  const pad = 80

  const zoomX = (container.width - pad * 2) / contentW
  const zoomY = (container.height - pad * 2) / contentH
  const zoom = Math.min(Math.max(zoomX, zoomY, 0.1), 0.9)

  const cx = minX + contentW / 2
  const cy = minY + contentH / 2
  const x = container.width / 2 - cx * zoom
  const y = container.height / 2 - cy * zoom

  return { x, y, zoom }
}

/**
 * WorkbenchPanel uses a "store swap" pattern:
 * When activated, save vault canvas state, load the workbench into canvas-store.
 * When deactivated, save the workbench and restore the vault canvas.
 * The panel stays mounted (keep-alive) so terminal sessions survive tab switches.
 */
export function WorkbenchPanel() {
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const setCachedData = useWorkbenchStore((s) => s.setCachedData)
  const setWorkbenchActions = useWorkbenchActionStore((s) => s.setRegistration)
  const resetWorkbenchActions = useWorkbenchActionStore((s) => s.reset)

  const nodes = useCanvasStore((s) => s.nodes)
  const edges = useCanvasStore((s) => s.edges)
  const viewport = useCanvasStore((s) => s.viewport)
  const clearSelection = useCanvasStore((s) => s.clearSelection)
  const selectedNodeIds = useCanvasStore((s) => s.selectedNodeIds)
  const isDirty = useCanvasStore((s) => s.isDirty)
  const toCanvasFile = useCanvasStore((s) => s.toCanvasFile)
  const markSaved = useCanvasStore((s) => s.markSaved)

  const [isLoading, setIsLoading] = useState(true)
  const [threadOpen, setThreadOpen] = useState(false)
  const [resolvedProjectPath, setResolvedProjectPath] = useState<{
    readonly vaultPath: string
    readonly projectPath: string
  } | null>(null)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const isActiveTab = activeTabId === 'workbench'
  const projectPath =
    vaultPath == null
      ? null
      : resolvedProjectPath?.vaultPath === vaultPath
        ? resolvedProjectPath.projectPath
        : vaultPath
  const threadState = useSessionThread(projectPath, isActiveTab)

  const containerRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ width: 1920, height: 1080 })
  const prevSizeRef = useRef(containerSize)

  // Keep content centered when the container resizes
  useEffect(() => {
    const prev = prevSizeRef.current
    prevSizeRef.current = containerSize
    if (prev.width === 1920 && prev.height === 1080) return
    const dw = containerSize.width - prev.width
    const dh = containerSize.height - prev.height
    if (dw === 0 && dh === 0) return
    const { x, y, zoom } = useCanvasStore.getState().viewport
    useCanvasStore.getState().setViewport({ x: x + dw / 2, y: y + dh / 2, zoom })
  }, [containerSize])

  useEffect(() => {
    if (!isActiveTab) return
    if (typeof window.api?.on?.sessionDetected !== 'function') return
    const unsub = window.api.on.sessionDetected((event) => {
      if (event.active) setThreadOpen(true)
    })
    return unsub
  }, [isActiveTab])

  const savedCanvasState = useRef<{ filePath: string | null; data: CanvasFile } | null>(null)
  const isMounted = useRef(true)

  // Auto-detect project root on vault change
  useEffect(() => {
    if (!vaultPath) return
    let cancelled = false
    detectProjectRoot(vaultPath).then((root) => {
      if (!cancelled) {
        setResolvedProjectPath({ vaultPath, projectPath: root })
      }
    })
    return () => {
      cancelled = true
    }
  }, [vaultPath])

  // Activity monitoring: glow cards when files change
  useProjectActivity(!isLoading, projectPath)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height
        })
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // --- Store swap: save vault canvas, load workbench ---
  useEffect(() => {
    if (!projectPath) return
    isMounted.current = true

    const store = useCanvasStore.getState()

    // Save current vault canvas state
    savedCanvasState.current = {
      filePath: store.filePath,
      data: store.toCanvasFile()
    }

    async function loadWorkbench() {
      setIsLoading(true)

      // Migrate legacy filename before anything reads from disk
      await migrateWorkbenchFile(projectPath!).catch(() => {})

      const canvasPath = getWorkbenchPath(projectPath!)

      let canvasData: CanvasFile
      try {
        // Parse session events to discover which files Claude touched
        const sessionEvents = await window.api.workbench.parseSessions(projectPath!)

        if (!isMounted.current) return

        // Generate layout from session events
        const { nodes } = layoutWorkbench(sessionEvents, projectPath!, containerSize)

        // Center on the first terminal card
        const terminalNode = nodes.find((n) => n.type === 'terminal')
        const vp = terminalNode
          ? centerOnNode(terminalNode, containerSize)
          : fitViewportToNodes(nodes, containerSize)

        canvasData = { nodes, edges: [], viewport: vp }
        setCachedData(canvasData)
      } catch (err) {
        console.error('[WorkbenchPanel] Failed to load workbench:', err)
        canvasData = createCanvasFile()
      }

      if (!isMounted.current) return
      useCanvasStore.getState().loadCanvas(canvasPath, canvasData)
      setIsLoading(false)

      // Start watching the project directory
      window.api.workbench.watchStart(projectPath!).catch(() => {})
    }

    loadWorkbench()

    return () => {
      isMounted.current = false
      window.api.workbench.watchStop().catch(() => {})

      // Save current workbench state
      const currentData = useCanvasStore.getState().toCanvasFile()
      setCachedData(currentData)
      if (projectPath) {
        const canvasPath = getWorkbenchPath(projectPath)
        saveCanvas(canvasPath, currentData).catch(() => {})
      }

      // Restore vault canvas
      const prev = savedCanvasState.current
      if (prev?.filePath) {
        useCanvasStore.getState().loadCanvas(prev.filePath, prev.data)
      } else {
        useCanvasStore.getState().closeCanvas()
      }
    }
  }, [projectPath]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save debounce
  useEffect(() => {
    if (!isDirty || !projectPath) return
    const canvasPath = getWorkbenchPath(projectPath)
    const timer = setTimeout(async () => {
      const data = toCanvasFile()
      setCachedData(data)
      await saveCanvas(canvasPath, data)
      markSaved()
    }, 500)
    return () => clearTimeout(timer)
  }, [isDirty, toCanvasFile, markSaved, projectPath, setCachedData])

  const visibleNodes = useViewportCulling(nodes, viewport, containerSize)
  const lod = getLodLevel(viewport.zoom)

  const handleBackgroundClick = useCallback(() => {
    clearSelection()
  }, [clearSelection])

  const handleDoubleClick = useCallback(
    (canvasX: number, canvasY: number, _screenX: number, _screenY: number) => {
      // Find the node under the double-click position
      const currentNodes = useCanvasStore.getState().nodes
      const hit = currentNodes.find(
        (n) =>
          n.type === 'project-file' &&
          canvasX >= n.position.x &&
          canvasX <= n.position.x + n.size.width &&
          canvasY >= n.position.y &&
          canvasY <= n.position.y + n.size.height
      )
      if (!hit) return

      // Open the file in the editor
      const filePath = hit.metadata?.filePath as string | undefined
      if (!filePath) return

      openArtifactInEditor(filePath)
    },
    []
  )

  const handleRefresh = useCallback(async () => {
    if (!projectPath) return
    setIsLoading(true)
    try {
      const sessionEvents = await window.api.workbench.parseSessions(projectPath)
      const { nodes } = layoutWorkbench(sessionEvents, projectPath, containerSize)

      const terminalNode = nodes.find((n) => n.type === 'terminal')
      const vp = terminalNode
        ? centerOnNode(terminalNode, containerSize)
        : fitViewportToNodes(nodes, containerSize)

      const canvasData: CanvasFile = { nodes, edges: [], viewport: vp }
      setCachedData(canvasData)
      useCanvasStore.getState().loadCanvas(getWorkbenchPath(projectPath), canvasData)
    } catch {
      // Parse failed
    }
    setIsLoading(false)
  }, [projectPath, setCachedData, containerSize])

  const handleFitAll = useCallback(() => {
    const vp = fitViewportToNodes(nodes, containerSize)
    useCanvasStore.getState().setViewport(vp)
  }, [nodes, containerSize])

  const handleAddTerminal = useCallback(() => {
    if (!projectPath) return
    // Position new terminal to the right of or below the last terminal
    const terminalNodes = nodes.filter((n) => n.type === 'terminal')
    const lastTerminal = terminalNodes[terminalNodes.length - 1]
    const x = lastTerminal ? lastTerminal.position.x : 0
    const y = lastTerminal ? lastTerminal.position.y + lastTerminal.size.height + 20 : 0

    const newTerminal = createCanvasNode(
      'terminal',
      { x, y },
      {
        size: { width: 500, height: 350 },
        content: '',
        metadata: { initialCwd: projectPath }
      }
    )
    useCanvasStore.getState().addNode(newTerminal)
  }, [projectPath, nodes])

  const projectName = projectPath?.split('/').pop() ?? 'Project'
  const selectedNodes = useMemo(
    () => nodes.filter((node) => selectedNodeIds.has(node.id)),
    [nodes, selectedNodeIds]
  )

  const handleCreateTension = useCallback(async () => {
    if (!vaultPath || !projectPath) return

    const document = buildTensionArtifactDocument({
      projectName,
      projectPath,
      now: new Date(),
      selectedNodes,
      milestones: threadState.milestones
    })

    await createAndOpenSystemArtifact({
      kind: 'tension',
      filename: document.filename,
      content: document.markdown,
      vaultPath
    })
  }, [projectName, projectPath, selectedNodes, threadState.milestones, vaultPath])

  const handlePromoteSelection = useCallback(async () => {
    if (!vaultPath || !projectPath || selectedNodes.length === 0) return

    const document = buildPatternArtifactDocument({
      projectName,
      projectPath,
      now: new Date(),
      selectedNodes,
      selectedNodeIds,
      edges
    })

    const absoluteSnapshotPath = `${vaultPath}/${document.snapshotPath}`
    await window.api.fs.writeFile(absoluteSnapshotPath, serializeCanvas(document.snapshot))
    await createAndOpenSystemArtifact({
      kind: 'pattern',
      filename: document.filename,
      content: document.markdown,
      vaultPath
    })
  }, [edges, projectName, projectPath, selectedNodeIds, selectedNodes, vaultPath])

  const handleEndSession = useCallback(async () => {
    if (!vaultPath || !projectPath) return

    const allSessionEvents = await window.api.workbench.parseSessions(projectPath)
    const sessionBoundary = threadState.milestones.find(
      (milestone) => milestone.type === 'session-switched'
    )
    const oldestMilestone = threadState.milestones
      .filter((milestone) => milestone.type !== 'session-switched')
      .reduce<
        number | null
      >((min, milestone) => (min == null ? milestone.timestamp : Math.min(min, milestone.timestamp)), null)
    const relevantEvents = allSessionEvents.filter((event) => {
      if (sessionBoundary && event.timestamp < sessionBoundary.timestamp) return false
      if (oldestMilestone != null && event.timestamp < oldestMilestone - 60_000) return false
      return true
    })

    const document = buildSessionArtifactDocument({
      projectName,
      projectPath,
      now: new Date(),
      milestones: threadState.milestones,
      sessionEvents: relevantEvents
    })

    await createAndOpenSystemArtifact({
      kind: 'session',
      filename: document.filename,
      content: document.markdown,
      vaultPath
    })

    threadState.clear()
    setThreadOpen(false)
  }, [projectName, projectPath, threadState, vaultPath])

  const handleToggleThread = useCallback(() => {
    setThreadOpen((prev) => !prev)
  }, [])

  useEffect(() => {
    setWorkbenchActions({
      refresh: handleRefresh,
      fitAll: handleFitAll,
      addTerminal: handleAddTerminal,
      createTension: handleCreateTension,
      savePattern: handlePromoteSelection,
      endSession: handleEndSession,
      toggleThread: handleToggleThread,
      selectedNodeCount: selectedNodes.length,
      milestoneCount: threadState.milestones.length,
      isLive: threadState.isLive,
      threadOpen
    })
  }, [
    handleAddTerminal,
    handleCreateTension,
    handleEndSession,
    handleFitAll,
    handlePromoteSelection,
    handleRefresh,
    handleToggleThread,
    selectedNodes.length,
    setWorkbenchActions,
    threadOpen,
    threadState.isLive,
    threadState.milestones.length
  ])

  useEffect(() => resetWorkbenchActions, [resetWorkbenchActions])

  return (
    <div ref={containerRef} className="h-full relative">
      {/* Toolbar */}
      <div
        className="absolute top-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-2 px-3 py-2"
        style={{
          left: 'calc(50% - 200px)',
          backgroundColor: colors.bg.elevated,
          borderRadius: floatingPanel.borderRadius,
          boxShadow: floatingPanel.shadowCompact,
          backdropFilter: floatingPanel.blur.compact
        }}
      >
        <span
          className="text-xs font-medium"
          style={{ color: colors.text.primary, fontFamily: typography.fontFamily.mono }}
        >
          {projectName}/
        </span>
        <ToolbarStatusPill
          label={threadState.isLive ? 'live session' : 'idle'}
          color={threadState.isLive ? '#4ade80' : colors.text.muted}
        />
        {selectedNodes.length > 0 && (
          <ToolbarStatusPill
            label={`${selectedNodes.length} selected`}
            color={getArtifactColor('pattern')}
          />
        )}
        {threadState.milestones.length > 0 && (
          <ToolbarStatusPill
            label={`${threadState.milestones.length} milestones`}
            color={getArtifactColor('session')}
          />
        )}
        <ToolbarDivider />
        <ToolbarButton
          label={isLoading ? 'Refreshing…' : 'Refresh'}
          onClick={handleRefresh}
          title="Re-parse sessions and rebuild the workbench layout"
          disabled={isLoading}
        />
        <ToolbarButton
          label="Fit All"
          onClick={handleFitAll}
          title="Fit every workbench card into view"
        />
        <ToolbarDivider />
        <ToolbarButton
          label="Add Terminal"
          onClick={handleAddTerminal}
          title="Add a new terminal card"
          tone={colors.accent.default}
        />
        <ToolbarButton
          label="Capture Tension"
          onClick={handleCreateTension}
          title="Capture the current investigation as a tension artifact"
          tone={getArtifactColor('tension')}
        />
        <ToolbarButton
          label="Save Pattern"
          onClick={handlePromoteSelection}
          disabled={selectedNodes.length === 0}
          title="Turn the selected cards into a reusable pattern"
          tone={getArtifactColor('pattern')}
        />
        <ToolbarButton
          label="End Session"
          onClick={handleEndSession}
          disabled={threadState.milestones.length === 0}
          title="Capture the current thread as a completed session artifact"
          tone={getArtifactColor('session')}
        />
        <ToolbarDivider />
        <ToolbarButton
          label={threadOpen ? 'Hide Thread' : 'Show Thread'}
          onClick={handleToggleThread}
          title={threadOpen ? 'Hide the live thread' : 'Show the live thread'}
          tone={threadOpen ? colors.accent.default : colors.text.secondary}
        />
      </div>

      <CanvasSurface onDoubleClick={handleDoubleClick} onBackgroundClick={handleBackgroundClick}>
        <EdgeLayer />
        {/* Zone labels removed — cards have type badges and title bars that
            communicate grouping. Fixed labels break once users drag cards. */}
        {visibleNodes.map((node: CanvasNode) => {
          if ((lod === 'dot' || lod === 'preview') && node.type !== 'terminal') {
            return <CardLodPreview key={node.id} node={node} lod={lod} />
          }
          const Card = LazyCards[node.type]
          if (!Card) return null
          return (
            <Suspense key={node.id} fallback={<CardShellSkeleton node={node} />}>
              <Card node={node} />
            </Suspense>
          )
        })}
      </CanvasSurface>

      <CanvasMinimap containerWidth={containerSize.width} containerHeight={containerSize.height} />

      {threadOpen && (
        <SessionThreadPanel
          state={threadState}
          onFileClick={(filePath) => {
            openArtifactInEditor(filePath, undefined, filePath)
          }}
        />
      )}
    </div>
  )
}
