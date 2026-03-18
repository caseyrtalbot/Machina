import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { CanvasSurface } from '../canvas/CanvasSurface'
import { useCanvasStore } from '../../store/canvas-store'
import { useClaudeConfigStore } from '../../store/claude-config-store'
import { useClaudeCanvasStore } from '../../store/claude-canvas-store'
import { useInspectorStore } from '../../store/inspector-store'
import { LazyCards } from '../canvas/card-registry'
import { CardShellSkeleton } from '../canvas/CardShellSkeleton'
import { CardLodPreview } from '../canvas/CardLodPreview'
import { EdgeLayer } from '../canvas/EdgeLayer'
import { CanvasMinimap } from '../canvas/CanvasMinimap'
import { useViewportCulling } from '../canvas/use-canvas-culling'
import { getLodLevel } from '../canvas/use-canvas-lod'
import { loadClaudeConfig } from '../../engine/claude-config-parser'
import { useVaultStore } from '../../store/vault-store'
import { layoutClaudeConfig, type ZoneLabel } from '../canvas/claude/claude-canvas-layout'
import { saveCanvas, loadCanvas } from '../canvas/canvas-io'
import { InspectorProvider } from './InspectorContext'
import { ConfigInspector } from './ConfigInspector'
import { CreationInspector } from './CreationInspector'
import { colors, typography } from '../../design/tokens'
import type { CanvasFile, CanvasNode } from '@shared/canvas-types'
import { createCanvasFile } from '@shared/canvas-types'

const CLAUDE_CANVAS_PATH_SUFFIX = '/.thought-engine-canvas.json'

function getCanvasPath(configPath: string): string {
  return configPath + CLAUDE_CANVAS_PATH_SUFFIX
}

/** Calculate a viewport that fits all nodes with padding. */
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
 * ClaudeConfigPanel uses a "store swap" pattern:
 * On mount, it saves the current canvas-store state (the vault canvas),
 * then loads the Claude config canvas data into canvas-store.
 * On unmount, it saves the claude canvas and restores the vault canvas.
 * This lets all existing canvas infrastructure (CanvasSurface, CardShell,
 * EdgeLayer, drag/resize/selection hooks) work without modification.
 */
export function ClaudeConfigPanel() {
  const setConfigPath = useClaudeConfigStore((s) => s.setConfigPath)
  const isConfigLoading = useClaudeConfigStore((s) => s.isLoading)
  const setConfig = useClaudeConfigStore((s) => s.setConfig)
  const setConfigLoading = useClaudeConfigStore((s) => s.setLoading)
  const setCachedData = useClaudeCanvasStore((s) => s.setCachedData)
  const cachedData = useClaudeCanvasStore((s) => s.cachedData)
  const vaultPath = useVaultStore((s) => s.vaultPath)

  // Resolve the real home path once on mount (preload has access to os.homedir())
  const configPath =
    useClaudeConfigStore((s) => s.configPath) ||
    (() => {
      const resolved = window.api.getHomePath() + '/.claude'
      setConfigPath(resolved)
      return resolved
    })()

  const nodes = useCanvasStore((s) => s.nodes)
  const viewport = useCanvasStore((s) => s.viewport)
  const clearSelection = useCanvasStore((s) => s.clearSelection)
  const isDirty = useCanvasStore((s) => s.isDirty)
  const toCanvasFile = useCanvasStore((s) => s.toCanvasFile)
  const markSaved = useCanvasStore((s) => s.markSaved)

  // Track container for viewport culling
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ width: 1920, height: 1080 })
  const [zoneLabels, setZoneLabels] = useState<readonly ZoneLabel[]>([])

  // Store the previous canvas state for restoration
  const savedCanvasState = useRef<{ filePath: string | null; data: CanvasFile } | null>(null)
  const isMounted = useRef(true)

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

  // --- Store swap: save vault canvas, load claude canvas ---
  useEffect(() => {
    isMounted.current = true

    const store = useCanvasStore.getState()

    // Save current vault canvas state
    savedCanvasState.current = {
      filePath: store.filePath,
      data: store.toCanvasFile()
    }

    // Load claude config canvas: always parse fresh, only reuse viewport position
    async function loadClaudeCanvas() {
      setConfigLoading(true)
      const canvasPath = getCanvasPath(configPath)

      // Try to get saved viewport (from disk or memory) for position continuity
      let savedViewport = cachedData?.viewport ?? null
      if (!savedViewport) {
        try {
          const exists = await window.api.fs.fileExists(canvasPath)
          if (exists) {
            const diskData = await loadCanvas(canvasPath)
            savedViewport = diskData.viewport
          }
        } catch {
          // No saved viewport
        }
      }

      // Always parse fresh config and generate layout from real data
      let canvasData: CanvasFile
      try {
        const config = await loadClaudeConfig(configPath, vaultPath ?? undefined)
        if (!isMounted.current) return
        setConfig(config)

        const { nodes, edges, labels } = layoutClaudeConfig(config)
        setZoneLabels(labels)

        const viewport = savedViewport ?? fitViewportToNodes(nodes, containerSize)
        canvasData = { nodes, edges, viewport }
        setCachedData(canvasData)
      } catch (err) {
        console.error('[ClaudeConfigPanel] Failed to load config:', err)
        canvasData = createCanvasFile()
      }

      if (!isMounted.current) return
      useCanvasStore.getState().loadCanvas(canvasPath, canvasData)
      setConfigLoading(false)
    }

    loadClaudeCanvas()

    // Cleanup: save claude canvas, restore vault canvas
    return () => {
      isMounted.current = false

      // Save current claude canvas state
      const currentData = useCanvasStore.getState().toCanvasFile()
      setCachedData(currentData)
      const canvasPath = getCanvasPath(configPath)
      saveCanvas(canvasPath, currentData).catch(() => {})

      // Restore vault canvas
      const prev = savedCanvasState.current
      if (prev?.filePath) {
        useCanvasStore.getState().loadCanvas(prev.filePath, prev.data)
      } else {
        useCanvasStore.getState().closeCanvas()
      }
    }
  }, [configPath]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save debounce
  useEffect(() => {
    if (!isDirty) return
    const canvasPath = getCanvasPath(configPath)
    const timer = setTimeout(async () => {
      const data = toCanvasFile()
      setCachedData(data)
      await saveCanvas(canvasPath, data)
      markSaved()
    }, 500)
    return () => clearTimeout(timer)
  }, [isDirty, toCanvasFile, markSaved, configPath, setCachedData])

  const inspectorFile = useInspectorStore((s) => s.inspectorFile)
  const closeInspector = useInspectorStore((s) => s.closeInspector)
  const creationMode = useInspectorStore((s) => s.creationMode)
  const cancelCreation = useInspectorStore((s) => s.cancelCreation)

  // Clear inspector when this panel unmounts
  useEffect(
    () => () => {
      useInspectorStore.getState().closeInspector()
    },
    []
  )

  const visibleNodes = useViewportCulling(nodes, viewport, containerSize)
  const lod = getLodLevel(viewport.zoom)

  const handleBackgroundClick = useCallback(() => {
    clearSelection()
  }, [clearSelection])

  const handleDoubleClick = useCallback(
    (_canvasX: number, _canvasY: number, _screenX: number, _screenY: number) => {
      // Phase 1: no context menu on double-click (read-only canvas)
    },
    []
  )

  const handleRefresh = useCallback(async () => {
    setConfigLoading(true)
    try {
      const config = await loadClaudeConfig(configPath, vaultPath ?? undefined)
      setConfig(config)
      const { nodes, edges, labels } = layoutClaudeConfig(config)
      setZoneLabels(labels)
      const viewport = fitViewportToNodes(nodes, containerSize)
      const canvasData: CanvasFile = { nodes, edges, viewport }
      setCachedData(canvasData)
      useCanvasStore.getState().loadCanvas(getCanvasPath(configPath), canvasData)
    } catch {
      // Parse failed
    }
    setConfigLoading(false)
  }, [configPath, setConfig, setConfigLoading, setCachedData, containerSize])

  const handleFitAll = useCallback(() => {
    const vp = fitViewportToNodes(nodes, containerSize)
    useCanvasStore.getState().setViewport(vp)
  }, [nodes, containerSize])

  const handleCreated = useCallback(
    async (filePath: string, title: string) => {
      await handleRefresh()
      useInspectorStore.getState().openInspector(filePath, title)
    },
    [handleRefresh]
  )

  return (
    <InspectorProvider value={useInspectorStore.getState().openInspector}>
      <div className="flex h-full w-full overflow-hidden">
        {/* Canvas panel - always at same DOM position to avoid remount */}
        <div
          className="overflow-hidden shrink-0"
          style={{ width: inspectorFile || creationMode ? '55%' : '100%' }}
        >
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
                ~/.claude/
              </span>
              <div className="w-px h-4" style={{ backgroundColor: colors.border.default }} />
              <button
                onClick={handleRefresh}
                className="text-xs px-2 py-0.5 rounded hover:opacity-80"
                style={{ color: colors.text.secondary }}
                title="Refresh config"
              >
                {isConfigLoading ? 'Loading...' : 'Refresh'}
              </button>
              <button
                onClick={handleFitAll}
                className="text-xs px-2 py-0.5 rounded hover:opacity-80"
                style={{ color: colors.text.secondary }}
                title="Fit all cards in view"
              >
                Fit All
              </button>
            </div>

            <CanvasSurface
              onDoubleClick={handleDoubleClick}
              onBackgroundClick={handleBackgroundClick}
            >
              <EdgeLayer />
              {/* Zone labels */}
              {zoneLabels.map((label) => (
                <div
                  key={label.text}
                  className="absolute select-none"
                  style={{
                    left: label.x,
                    top: label.y,
                    pointerEvents: label.configType ? 'auto' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                  }}
                >
                  <span
                    style={{
                      color: label.color,
                      fontSize: 14,
                      fontWeight: 600,
                      fontFamily: typography.fontFamily.display,
                      letterSpacing: '0.03em',
                      opacity: 0.8,
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {label.text}
                  </span>
                  {label.configType && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        useInspectorStore.getState().startCreation(label.configType!)
                      }}
                      style={{
                        background: label.color + '22',
                        color: label.color,
                        border: 'none',
                        borderRadius: 4,
                        width: 20,
                        height: 20,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 16,
                        fontWeight: 600,
                        cursor: 'pointer',
                        lineHeight: 1,
                        opacity: 0.4,
                        transition: 'opacity 150ms'
                      }}
                      onMouseEnter={(e) => {
                        ;(e.target as HTMLElement).style.opacity = '1'
                      }}
                      onMouseLeave={(e) => {
                        ;(e.target as HTMLElement).style.opacity = '0.4'
                      }}
                      title={`New ${label.configType}`}
                    >
                      +
                    </button>
                  )}
                </div>
              ))}
              {visibleNodes.map((node: CanvasNode) => {
                if (lod === 'dot' || lod === 'preview') {
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

            <CanvasMinimap
              containerWidth={containerSize.width}
              containerHeight={containerSize.height}
            />
          </div>
        </div>

        {/* Inspector panel - added/removed as sibling, canvas stays stable */}
        {(inspectorFile || creationMode) && (
          <>
            <div className="panel-divider" />
            <div className="flex-1 overflow-hidden min-w-[350px]">
              {creationMode ? (
                <CreationInspector
                  configType={creationMode.configType}
                  configPath={configPath}
                  projectPath={vaultPath ?? null}
                  onCreated={handleCreated}
                  onClose={cancelCreation}
                />
              ) : inspectorFile ? (
                <ConfigInspector
                  key={inspectorFile.path}
                  path={inspectorFile.path}
                  title={inspectorFile.title}
                  onClose={closeInspector}
                />
              ) : null}
            </div>
          </>
        )}
      </div>
    </InspectorProvider>
  )
}
