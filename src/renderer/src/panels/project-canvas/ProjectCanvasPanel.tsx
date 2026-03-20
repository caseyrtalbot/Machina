import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { CanvasSurface } from '../canvas/CanvasSurface'
import { useCanvasStore } from '../../store/canvas-store'
import { useProjectCanvasStore } from '../../store/project-canvas-store'
import { LazyCards } from '../canvas/card-registry'
import { CardShellSkeleton } from '../canvas/CardShellSkeleton'
import { CardLodPreview } from '../canvas/CardLodPreview'
import { EdgeLayer } from '../canvas/EdgeLayer'
import { CanvasMinimap } from '../canvas/CanvasMinimap'
import { useViewportCulling } from '../canvas/use-canvas-culling'
import { getLodLevel } from '../canvas/use-canvas-lod'
import { useVaultStore } from '../../store/vault-store'
import { layoutProjectCanvas } from './project-canvas-layout'
import { saveCanvas } from '../canvas/canvas-io'
import { useProjectActivity } from '../../hooks/useProjectActivity'
import { useSessionThread } from '../../hooks/useSessionThread'
import { useEditorStore } from '../../store/editor-store'
import { useTabStore } from '../../store/tab-store'
import { SessionThreadPanel } from './SessionThreadPanel'
import { colors, typography } from '../../design/tokens'
import type { CanvasFile, CanvasNode } from '@shared/canvas-types'
import { createCanvasFile, createCanvasNode } from '@shared/canvas-types'

const PROJECT_CANVAS_FILENAME = '.thought-engine-project-canvas.json'
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

function getCanvasPath(projectPath: string): string {
  return projectPath + '/' + PROJECT_CANVAS_FILENAME
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
 * ProjectCanvasPanel uses a "store swap" pattern:
 * When activated, save vault canvas state, load project canvas into canvas-store.
 * When deactivated, save project canvas and restore vault canvas.
 * The panel stays mounted (keep-alive) so terminal sessions survive tab switches.
 */
export function ProjectCanvasPanel() {
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const setCachedData = useProjectCanvasStore((s) => s.setCachedData)

  const nodes = useCanvasStore((s) => s.nodes)
  const viewport = useCanvasStore((s) => s.viewport)
  const clearSelection = useCanvasStore((s) => s.clearSelection)
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
  const isActiveTab = activeTabId === 'project-canvas'
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

  // --- Store swap: save vault canvas, load project canvas ---
  useEffect(() => {
    if (!projectPath) return
    isMounted.current = true

    const store = useCanvasStore.getState()

    // Save current vault canvas state
    savedCanvasState.current = {
      filePath: store.filePath,
      data: store.toCanvasFile()
    }

    async function loadProjectCanvas() {
      setIsLoading(true)
      const canvasPath = getCanvasPath(projectPath!)

      let canvasData: CanvasFile
      try {
        // Parse session events to discover which files Claude touched
        const sessionEvents = await window.api.project.parseSessions(projectPath!)

        if (!isMounted.current) return

        // Generate layout from session events
        const { nodes } = layoutProjectCanvas(sessionEvents, projectPath!, containerSize)

        // Center on the first terminal card
        const terminalNode = nodes.find((n) => n.type === 'terminal')
        const vp = terminalNode
          ? centerOnNode(terminalNode, containerSize)
          : fitViewportToNodes(nodes, containerSize)

        canvasData = { nodes, edges: [], viewport: vp }
        setCachedData(canvasData)
      } catch (err) {
        console.error('[ProjectCanvasPanel] Failed to load project canvas:', err)
        canvasData = createCanvasFile()
      }

      if (!isMounted.current) return
      useCanvasStore.getState().loadCanvas(canvasPath, canvasData)
      setIsLoading(false)

      // Start watching the project directory
      window.api.project.watchStart(projectPath!).catch(() => {})
    }

    loadProjectCanvas()

    return () => {
      isMounted.current = false
      window.api.project.watchStop().catch(() => {})

      // Save current project canvas state
      const currentData = useCanvasStore.getState().toCanvasFile()
      setCachedData(currentData)
      if (projectPath) {
        const canvasPath = getCanvasPath(projectPath)
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
    const canvasPath = getCanvasPath(projectPath)
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

      useEditorStore.getState().setActiveNote(hit.id, filePath)
      useTabStore.getState().activateTab('editor')
    },
    []
  )

  const handleRefresh = useCallback(async () => {
    if (!projectPath) return
    setIsLoading(true)
    try {
      const sessionEvents = await window.api.project.parseSessions(projectPath)
      const { nodes } = layoutProjectCanvas(sessionEvents, projectPath, containerSize)

      const terminalNode = nodes.find((n) => n.type === 'terminal')
      const vp = terminalNode
        ? centerOnNode(terminalNode, containerSize)
        : fitViewportToNodes(nodes, containerSize)

      const canvasData: CanvasFile = { nodes, edges: [], viewport: vp }
      setCachedData(canvasData)
      useCanvasStore.getState().loadCanvas(getCanvasPath(projectPath), canvasData)
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

  return (
    <div ref={containerRef} className="h-full relative">
      {/* Toolbar */}
      <div
        className="absolute top-3 left-3 z-10 flex items-center gap-2 px-3 py-1.5 rounded"
        style={{
          backgroundColor: colors.bg.elevated,
          border: `1px solid ${colors.border.default}`
        }}
      >
        <span
          className="text-xs font-medium"
          style={{ color: colors.text.primary, fontFamily: typography.fontFamily.mono }}
        >
          {projectName}/
        </span>
        <div className="w-px h-4" style={{ backgroundColor: colors.border.default }} />
        <button
          onClick={handleRefresh}
          className="text-xs px-2 py-0.5 rounded hover:opacity-80"
          style={{ color: colors.text.secondary }}
          title="Re-parse sessions and re-layout"
        >
          {isLoading ? 'Loading...' : 'Refresh'}
        </button>
        <button
          onClick={handleFitAll}
          className="text-xs px-2 py-0.5 rounded hover:opacity-80"
          style={{ color: colors.text.secondary }}
          title="Fit all cards in view"
        >
          Fit All
        </button>
        <div className="w-px h-4" style={{ backgroundColor: colors.border.default }} />
        <button
          onClick={handleAddTerminal}
          className="text-xs px-2 py-0.5 rounded hover:opacity-80"
          style={{ color: colors.accent.default }}
          title="Add a new terminal card"
        >
          + Terminal
        </button>
        <div className="w-px h-4" style={{ backgroundColor: colors.border.default }} />
        <button
          onClick={() => setThreadOpen((prev) => !prev)}
          className="text-xs px-2 py-0.5 rounded hover:opacity-80"
          style={{
            color: threadOpen ? colors.accent.default : colors.text.secondary
          }}
          title={threadOpen ? 'Hide live thread' : 'Show live thread'}
        >
          {'⚡'}
          {threadState.isLive && (
            <span
              className="inline-block w-1.5 h-1.5 rounded-full ml-1 animate-pulse"
              style={{ backgroundColor: '#4ade80' }}
            />
          )}
        </button>
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
            useEditorStore.getState().setActiveNote(filePath, filePath)
            useTabStore.getState().activateTab('editor')
          }}
        />
      )}
    </div>
  )
}
