import { useEffect, useMemo, useRef, useState } from 'react'
import { useCanvasStore } from '../../store/canvas-store'
import { useVaultStore } from '../../store/vault-store'
import { useSettingsStore } from '../../store/settings-store'
import { createCanvasNode } from '@shared/canvas-types'
import { generateClaudeMd } from '../../engine/claude-md-template'
import { TILE_PATTERNS, type TilePattern } from './canvas-tiling'
import { colors } from '../../design/tokens'
import { useClaudeStatus } from '../../hooks/use-claude-status'
import { ActionMenu } from './ActionMenu'
import type { ActionDefinition } from '@shared/action-types'
import type { AgentActionName } from '@shared/agent-action-types'
import type { AgentPhase } from '../../hooks/use-agent-orchestrator'
import { useSidebarSelectionStore } from '../../store/sidebar-selection-store'

interface CanvasToolbarProps {
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly onUndo: () => void
  readonly onRedo: () => void
  readonly onAddCard: () => void
  readonly onOpenImport: () => void
  readonly onOrganize: () => void
  readonly organizePhase: string
  readonly onAgentAction: (action: AgentActionName, anchor?: { x: number; y: number }) => void
  readonly onStopAgent: () => void
  readonly agentPhase: AgentPhase
  readonly activeAction: AgentActionName | null
  readonly onClear: () => void
  readonly onActionSelect: (actionId: string) => void
}

function Tip({
  label,
  shortcut
}: {
  readonly label: string
  readonly shortcut?: string
}): React.ReactElement {
  return (
    <span className="canvas-tooltip">
      {label}
      {shortcut && <span className="canvas-tooltip__shortcut">{shortcut}</span>}
    </span>
  )
}

/** Compute the canvas-space point at the center of the visible surface. */
function getViewportCenter(): { x: number; y: number } {
  const vp = useCanvasStore.getState().viewport
  const el = document.querySelector('[data-canvas-surface]')
  const w = el?.clientWidth ?? 1920
  const h = el?.clientHeight ?? 1080
  return {
    x: (-vp.x + w / 2) / vp.zoom,
    y: (-vp.y + h / 2) / vp.zoom
  }
}

/** Surface dimensions in CSS pixels; falls back to a sensible default for tests. */
function getSurfaceSize(): { width: number; height: number } {
  const el = document.querySelector('[data-canvas-surface]')
  return {
    width: el?.clientWidth ?? 1920,
    height: el?.clientHeight ?? 1080
  }
}

/** Compute a viewport that fits the given nodes inside the surface with padding. */
function fitViewportToNodes(
  nodes: ReadonlyArray<{
    position: { x: number; y: number }
    size: { width: number; height: number }
  }>,
  surface: { width: number; height: number }
): { x: number; y: number; zoom: number } {
  if (nodes.length === 0) return { x: 0, y: 0, zoom: 1 }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.position.x)
    minY = Math.min(minY, n.position.y)
    maxX = Math.max(maxX, n.position.x + n.size.width)
    maxY = Math.max(maxY, n.position.y + n.size.height)
  }

  const contentW = Math.max(1, maxX - minX)
  const contentH = Math.max(1, maxY - minY)
  const pad = 80

  const zoomX = (surface.width - pad * 2) / contentW
  const zoomY = (surface.height - pad * 2) / contentH
  const zoom = Math.min(Math.max(Math.min(zoomX, zoomY), 0.1), 1)

  const cx = minX + contentW / 2
  const cy = minY + contentH / 2
  const x = surface.width / 2 - cx * zoom
  const y = surface.height / 2 - cy * zoom

  return { x, y, zoom }
}

export function CanvasToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onAddCard,
  onOpenImport,
  onOrganize,
  organizePhase,
  onAgentAction,
  onStopAgent,
  agentPhase,
  activeAction,
  onClear,
  onActionSelect
}: CanvasToolbarProps): React.ReactElement {
  const viewport = useCanvasStore((s) => s.viewport)
  const setViewport = useCanvasStore((s) => s.setViewport)
  const focusFrames = useCanvasStore((s) => s.focusFrames)
  const selectedNodeIds = useCanvasStore((s) => s.selectedNodeIds)
  const nodes = useCanvasStore((s) => s.nodes)
  const hasNodes = nodes.length > 0
  const showAllEdges = useCanvasStore((s) => s.showAllEdges)
  const toggleShowAllEdges = useCanvasStore((s) => s.toggleShowAllEdges)
  const gridDotVisibility = useSettingsStore((s) => s.env.gridDotVisibility)
  const cardBlur = useSettingsStore((s) => s.env.cardBlur)
  const setEnv = useSettingsStore((s) => s.setEnv)
  const artifacts = useVaultStore((s) => s.artifacts)
  const graph = useVaultStore((s) => s.graph)
  const [tileMenuOpen, setTileMenuOpen] = useState(false)
  const [envMenuOpen, setEnvMenuOpen] = useState(false)
  const [agentFlyoutOpen, setAgentFlyoutOpen] = useState(false)
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false)
  const [loadedActions, setLoadedActions] = useState<ActionDefinition[]>([])
  const claudeStatus = useClaudeStatus()
  const tileMenuRef = useRef<HTMLDivElement>(null)
  const envMenuRef = useRef<HTMLDivElement>(null)
  const agentFlyoutRef = useRef<HTMLDivElement>(null)
  const zoomMenuRef = useRef<HTMLDivElement>(null)

  const sidebarSelectedPaths = useSidebarSelectionStore((s) => s.selectedPaths)
  const sidebarSelectedCount = sidebarSelectedPaths.size
  const rawFileCount = useVaultStore((s) => s.rawFileCount)
  const scopeLabel =
    sidebarSelectedCount > 0
      ? `${sidebarSelectedCount} file${sidebarSelectedCount !== 1 ? 's' : ''} selected`
      : `Entire vault (${rawFileCount} notes)`

  const thinkBusy = agentPhase !== 'idle'
  const isComputing = agentPhase === 'computing'
  const isCompileRunning = isComputing && activeAction === 'compile'
  const isCompileBusy = isComputing && activeAction !== 'compile'

  const unprocessedSourceCount = useMemo(() => {
    if (!graph) return 0
    const sourceArtifactIds = new Set<string>()
    for (const artifact of artifacts) {
      if (artifact.origin === 'source') sourceArtifactIds.add(artifact.id)
    }
    const compiledSourceIds = new Set<string>()
    for (const edge of graph.edges) {
      if (edge.kind === 'derived_from' && sourceArtifactIds.has(edge.target)) {
        compiledSourceIds.add(edge.target)
      }
    }
    return sourceArtifactIds.size - compiledSourceIds.size
  }, [artifacts, graph])

  const hasSelection = selectedNodeIds.size > 0
  const compileEnabled = unprocessedSourceCount > 0 || hasSelection
  const clearEnabled = hasNodes && !isComputing

  useEffect(() => {
    if (!tileMenuOpen && !envMenuOpen && !agentFlyoutOpen && !zoomMenuOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      if (tileMenuRef.current && !tileMenuRef.current.contains(event.target as Node)) {
        setTileMenuOpen(false)
      }
      if (envMenuRef.current && !envMenuRef.current.contains(event.target as Node)) {
        setEnvMenuOpen(false)
      }
      if (agentFlyoutRef.current && !agentFlyoutRef.current.contains(event.target as Node)) {
        setAgentFlyoutOpen(false)
      }
      if (zoomMenuRef.current && !zoomMenuRef.current.contains(event.target as Node)) {
        setZoomMenuOpen(false)
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setTileMenuOpen(false)
        setEnvMenuOpen(false)
        setAgentFlyoutOpen(false)
        setZoomMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [tileMenuOpen, envMenuOpen, agentFlyoutOpen, zoomMenuOpen])

  const zoomIn = () => setViewport({ ...viewport, zoom: Math.min(3.0, viewport.zoom * 1.2) })
  const zoomOut = () => setViewport({ ...viewport, zoom: Math.max(0.1, viewport.zoom / 1.2) })
  const resetView = () => setViewport({ x: 0, y: 0, zoom: 1 })

  const zoomToActualSize = () => {
    const surface = getSurfaceSize()
    const cx = (-viewport.x + surface.width / 2) / viewport.zoom
    const cy = (-viewport.y + surface.height / 2) / viewport.zoom
    const nextZoom = 1
    setViewport({
      x: surface.width / 2 - cx * nextZoom,
      y: surface.height / 2 - cy * nextZoom,
      zoom: nextZoom
    })
  }

  const fitAll = () => {
    if (nodes.length === 0) return
    setViewport(fitViewportToNodes(nodes, getSurfaceSize()))
  }

  const fitSelection = () => {
    if (selectedNodeIds.size === 0) return
    const selected = nodes.filter((n) => selectedNodeIds.has(n.id))
    if (selected.length === 0) return
    setViewport(fitViewportToNodes(selected, getSurfaceSize()))
  }

  const zoomPercent = Math.round(viewport.zoom * 100)

  return (
    <div className="canvas-toolrail absolute top-3 left-3 z-30">
      {/* INPUT: get stuff onto the canvas */}
      <div className="canvas-toolbtn-wrap">
        <button
          onClick={onAddCard}
          className="canvas-toolbtn"
          data-testid="canvas-add-card"
          aria-label="Add card"
          style={{ color: colors.text.secondary }}
        >
          <svg
            width={14}
            height={14}
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <line x1="7" y1="2" x2="7" y2="12" />
            <line x1="2" y1="7" x2="12" y2="7" />
          </svg>
        </button>
        <Tip label="Add card" />
      </div>
      <div className="canvas-toolbtn-wrap">
        <button
          onClick={onOpenImport}
          className="canvas-toolbtn"
          data-testid="canvas-import"
          aria-label="Import notes"
          style={{ color: colors.text.secondary }}
        >
          <svg
            width={14}
            height={14}
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="3" cy="3" r="1.5" />
            <circle cx="11" cy="3" r="1.5" />
            <circle cx="7" cy="11" r="1.5" />
            <line x1="4.2" y1="3.8" x2="5.8" y2="9.8" />
            <line x1="9.8" y1="3.8" x2="8.2" y2="9.8" />
            <line x1="4.5" y1="3" x2="9.5" y2="3" />
          </svg>
        </button>
        <Tip label="Import notes" shortcut="⌘G" />
      </div>
      <div className="canvas-toolbtn-wrap" style={{ position: 'relative' }}>
        <button
          onClick={async () => {
            if (!claudeStatus.installed) return
            const vaultPath = useVaultStore.getState().vaultPath
            if (!vaultPath) return

            const claudeMdPath = `${vaultPath}/CLAUDE.md`
            const exists = await window.api.fs.fileExists(claudeMdPath)
            if (!exists) {
              const vaultName = vaultPath.split('/').pop() ?? 'Vault'
              await window.api.fs.writeFile(claudeMdPath, generateClaudeMd(vaultName))
            }

            const vp = useCanvasStore.getState().viewport
            const node = createCanvasNode(
              'terminal',
              { x: -vp.x + 200, y: -vp.y + 100 },
              { metadata: { initialCommand: 'claude' } }
            )
            useCanvasStore.getState().addNode(node)
          }}
          className={`canvas-toolbtn ${claudeStatus.installed ? 'canvas-toolbtn--accent' : ''}`}
          disabled={!claudeStatus.installed}
          aria-label={
            !claudeStatus.installed
              ? 'Claude Code not installed'
              : !claudeStatus.authenticated
                ? 'Start Claude (not signed in)'
                : 'Start Claude'
          }
          style={!claudeStatus.installed ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
        >
          <svg
            width={14}
            height={14}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
          </svg>
        </button>
        {claudeStatus.installed && !claudeStatus.authenticated && (
          <span
            className="absolute rounded-full"
            style={{
              top: 2,
              right: 2,
              width: 6,
              height: 6,
              backgroundColor: colors.claude.warning
            }}
          />
        )}
        <Tip
          label={
            !claudeStatus.installed
              ? 'Claude Code not installed'
              : !claudeStatus.authenticated
                ? 'Start Claude (not signed in)'
                : 'Start Claude'
          }
        />
      </div>

      <div className="canvas-toolrail__divider" />

      {/* VIEW: how am I seeing it */}
      <div className="canvas-toolbtn-wrap">
        <button onClick={zoomIn} className="canvas-toolbtn" aria-label="Zoom in">
          +
        </button>
        <Tip label="Zoom in" />
      </div>
      <div ref={zoomMenuRef} style={{ position: 'relative' }}>
        <div className="canvas-toolbtn-wrap">
          <button
            onClick={() => setZoomMenuOpen((prev) => !prev)}
            className="canvas-toolbtn canvas-zoom-badge"
            data-testid="canvas-zoom-menu"
            aria-label={`Zoom ${zoomPercent}%`}
            aria-haspopup="menu"
            aria-expanded={zoomMenuOpen}
          >
            {zoomPercent}%
          </button>
          <Tip label="Zoom" />
        </div>
        {zoomMenuOpen && (
          <div
            className="sidebar-popover absolute flex flex-col py-1"
            role="menu"
            style={{
              top: 0,
              left: '100%',
              marginLeft: 6,
              minWidth: 170,
              zIndex: 50
            }}
          >
            <button
              type="button"
              role="menuitem"
              className="sidebar-popover-item"
              style={{ color: colors.text.primary }}
              onClick={() => {
                zoomToActualSize()
                setZoomMenuOpen(false)
              }}
            >
              Zoom to 100%
            </button>
            <button
              type="button"
              role="menuitem"
              className="sidebar-popover-item"
              style={{
                color: hasNodes ? colors.text.primary : colors.text.muted,
                cursor: hasNodes ? 'pointer' : 'not-allowed'
              }}
              disabled={!hasNodes}
              onClick={() => {
                fitAll()
                setZoomMenuOpen(false)
              }}
            >
              Fit all
            </button>
            <button
              type="button"
              role="menuitem"
              className="sidebar-popover-item"
              style={{
                color: hasSelection ? colors.text.primary : colors.text.muted,
                cursor: hasSelection ? 'pointer' : 'not-allowed'
              }}
              disabled={!hasSelection}
              onClick={() => {
                fitSelection()
                setZoomMenuOpen(false)
              }}
            >
              Zoom to selection
            </button>
            <div className="sidebar-popover-divider mx-3 my-1" />
            <button
              type="button"
              role="menuitem"
              className="sidebar-popover-item"
              style={{ color: colors.text.secondary }}
              onClick={() => {
                resetView()
                setZoomMenuOpen(false)
              }}
            >
              Reset view
            </button>
          </div>
        )}
      </div>
      <div className="canvas-toolbtn-wrap">
        <button onClick={zoomOut} className="canvas-toolbtn" aria-label="Zoom out">
          -
        </button>
        <Tip label="Zoom out" />
      </div>
      <div className="canvas-toolbtn-wrap">
        <button
          onClick={toggleShowAllEdges}
          className={`canvas-toolbtn${showAllEdges ? ' canvas-toolbtn--active' : ''}`}
          aria-label={showAllEdges ? 'Hide edges' : 'Show edges'}
          aria-pressed={showAllEdges}
        >
          <svg
            width={14}
            height={14}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <circle cx="4" cy="4" r="2" />
            <circle cx="12" cy="12" r="2" />
            <line x1="5.5" y1="5.5" x2="10.5" y2="10.5" />
          </svg>
        </button>
        <Tip label={showAllEdges ? 'Hide edges' : 'Show edges'} />
      </div>
      <div ref={envMenuRef} style={{ position: 'relative' }}>
        <div className="canvas-toolbtn-wrap">
          <button
            onClick={() => setEnvMenuOpen((prev) => !prev)}
            className="canvas-toolbtn"
            data-testid="canvas-env-settings"
            aria-label="Environment settings"
            aria-haspopup="menu"
            aria-expanded={envMenuOpen}
          >
            <svg
              width={14}
              height={14}
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <circle cx="8" cy="8" r="3" />
              <line x1="8" y1="1" x2="8" y2="4" />
              <line x1="8" y1="12" x2="8" y2="15" />
              <line x1="1" y1="8" x2="4" y2="8" />
              <line x1="12" y1="8" x2="15" y2="8" />
            </svg>
          </button>
          <Tip label="Environment" />
        </div>
        {envMenuOpen && (
          <div
            className="sidebar-popover absolute flex flex-col gap-3 p-3"
            style={{
              top: 0,
              left: '100%',
              marginLeft: 6,
              minWidth: 180,
              zIndex: 50
            }}
          >
            <div className="flex flex-col gap-1">
              <span
                style={{
                  fontSize: 10,
                  color: colors.text.muted,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase'
                }}
              >
                Grid dots
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={gridDotVisibility}
                onChange={(e) => setEnv('gridDotVisibility', Number(e.target.value))}
                className="graph-slider w-full"
                style={{ accentColor: 'var(--color-text-primary)' }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span
                style={{
                  fontSize: 10,
                  color: colors.text.muted,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase'
                }}
              >
                Card blur
              </span>
              <input
                type="range"
                min={0}
                max={32}
                step={2}
                value={cardBlur}
                onChange={(e) => setEnv('cardBlur', Number(e.target.value))}
                className="graph-slider w-full"
                style={{ accentColor: 'var(--color-text-primary)' }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="canvas-toolrail__divider" />

      {/* HISTORY: take it back */}
      <div className="canvas-toolbtn-wrap">
        <button
          onClick={onUndo}
          className="canvas-toolbtn"
          disabled={!canUndo}
          data-testid="canvas-undo"
          aria-label="Undo"
        >
          <svg
            width={14}
            height={14}
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <polyline points="3 7 6 4" />
            <polyline points="3 7 6 10" />
            <path d="M6 7h4a2 2 0 0 1 0 4H8" />
          </svg>
        </button>
        <Tip label="Undo" shortcut="⌘Z" />
      </div>
      <div className="canvas-toolbtn-wrap">
        <button
          onClick={onRedo}
          className="canvas-toolbtn"
          disabled={!canRedo}
          data-testid="canvas-redo"
          aria-label="Redo"
        >
          <svg
            width={14}
            height={14}
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <polyline points="11 7 8 4" />
            <polyline points="11 7 8 10" />
            <path d="M8 7H4a2 2 0 0 0 0 4h2" />
          </svg>
        </button>
        <Tip label="Redo" shortcut="⇧⌘Z" />
      </div>

      <div className="canvas-toolrail__divider" />

      {/* ARRANGE: move things around */}
      <div ref={tileMenuRef} style={{ position: 'relative' }}>
        <div className="canvas-toolbtn-wrap">
          <button
            onClick={() => setTileMenuOpen((prev) => !prev)}
            className="canvas-toolbtn"
            data-testid="canvas-tile"
            aria-label="Tile layout"
            aria-haspopup="menu"
            aria-expanded={tileMenuOpen}
          >
            <svg
              width={14}
              height={14}
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <rect x="1" y="1" width="5" height="5" rx="0.5" />
              <rect x="8" y="1" width="5" height="5" rx="0.5" />
              <rect x="1" y="8" width="5" height="5" rx="0.5" />
              <rect x="8" y="8" width="5" height="5" rx="0.5" />
            </svg>
          </button>
          <Tip label="Tile layout" shortcut="⌘L" />
        </div>
        {tileMenuOpen && (
          <div
            className="sidebar-popover absolute flex flex-col py-1"
            style={{
              top: 0,
              left: '100%',
              marginLeft: 6,
              minWidth: 150,
              zIndex: 50
            }}
          >
            <button
              className="sidebar-popover-item"
              style={{ color: colors.text.primary }}
              onClick={() => {
                const center = getViewportCenter()
                const { artifacts, graph, fileToId } = useVaultStore.getState()
                const fileToIdMap = new Map(Object.entries(fileToId))
                const artMap = new Map(artifacts.map((a) => [a.id, { id: a.id, tags: a.tags }]))
                useCanvasStore
                  .getState()
                  .applySemanticLayout(center, fileToIdMap, artMap, graph.edges)
                setTileMenuOpen(false)
              }}
            >
              Organize by topic
            </button>
            <div className="sidebar-popover-divider mx-3 my-1" />
            {TILE_PATTERNS.map((p) => (
              <button
                key={p.id}
                className="sidebar-popover-item"
                style={{ color: colors.text.secondary }}
                onClick={() => {
                  useCanvasStore
                    .getState()
                    .applyTileLayout(p.id as TilePattern, getViewportCenter())
                  setTileMenuOpen(false)
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="canvas-toolbtn-wrap">
        <button
          onClick={onOrganize}
          disabled={organizePhase === 'processing'}
          className="canvas-toolbtn"
          data-testid="canvas-organize"
          aria-label={organizePhase === 'processing' ? 'Organizing…' : 'Organize'}
          style={{ cursor: organizePhase === 'processing' ? 'wait' : undefined }}
        >
          <svg
            width={14}
            height={14}
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="1" y="1" width="12" height="12" rx="2" />
            <rect x="3" y="3" width="4" height="3.5" rx="0.8" />
            <rect x="3" y="8" width="3" height="3" rx="0.8" />
            <rect x="8" y="5" width="3.5" height="3.5" rx="0.8" />
          </svg>
        </button>
        <Tip label={organizePhase === 'processing' ? 'Organizing\u2026' : 'Organize'} />
      </div>

      <div className="canvas-toolrail__divider" />

      {/* THINK: have the agent do something */}
      <div className="canvas-toolbtn-wrap">
        <button
          onClick={() => {
            if (hasNodes && !thinkBusy) onAgentAction('challenge')
          }}
          className="canvas-toolbtn"
          disabled={thinkBusy || !hasNodes}
          data-testid="canvas-think"
          aria-label={
            thinkBusy
              ? 'Thinking…'
              : !hasNodes
                ? 'Think — add cards first'
                : 'Think — challenge for insights'
          }
          style={{
            color: thinkBusy || !hasNodes ? colors.text.muted : colors.semantic.tension,
            cursor: thinkBusy ? 'wait' : undefined,
            opacity: !hasNodes ? 0.4 : 1
          }}
        >
          <svg
            width={14}
            height={14}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {/* Sparkle: 4-point star — challenge surfaces insights/tensions */}
            <path d="M8 2 L9.5 6.5 L14 8 L9.5 9.5 L8 14 L6.5 9.5 L2 8 L6.5 6.5 Z" />
          </svg>
        </button>
        <Tip
          label={
            thinkBusy
              ? 'Thinking\u2026'
              : !hasNodes
                ? 'Think \u2014 add cards first'
                : 'Think \u2014 challenge for insights'
          }
        />
      </div>
      <div className="canvas-toolbtn-wrap" style={{ position: 'relative' }}>
        <button
          onClick={() => {
            if (isCompileRunning) {
              onStopAgent()
            } else if (!isCompileBusy && compileEnabled) {
              onAgentAction('compile')
            }
          }}
          className="canvas-toolbtn"
          disabled={(!compileEnabled && !isCompileRunning) || isCompileBusy}
          data-testid="canvas-compile"
          aria-label={
            isCompileRunning
              ? 'Stop compile'
              : unprocessedSourceCount > 0
                ? `Compile — ${unprocessedSourceCount} unprocessed source${unprocessedSourceCount === 1 ? '' : 's'}`
                : 'Compile — process sources'
          }
          style={{
            color: isCompileRunning
              ? '#f87171'
              : compileEnabled
                ? colors.text.secondary
                : colors.text.muted,
            cursor: isCompileBusy ? 'not-allowed' : undefined,
            opacity: (!compileEnabled && !isCompileRunning) || isCompileBusy ? 0.4 : 1
          }}
        >
          {isCompileRunning ? (
            <svg width={14} height={14} viewBox="0 0 14 14" fill="currentColor">
              <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
            </svg>
          ) : (
            <svg
              width={14}
              height={14}
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {/* Arrow into base: sources converging into structure */}
              <path d="M7 2 L7 9" />
              <path d="M4 6 L7 9 L10 6" />
              <path d="M3 12 L11 12" />
            </svg>
          )}
        </button>
        {unprocessedSourceCount > 0 && !isCompileRunning && (
          <span
            className="absolute rounded-full"
            style={{
              top: 2,
              right: 2,
              width: 6,
              height: 6,
              backgroundColor: colors.accent.default
            }}
          />
        )}
        <Tip
          label={
            isCompileRunning
              ? 'Stop compile'
              : unprocessedSourceCount > 0
                ? `Compile \u2014 ${unprocessedSourceCount} unprocessed source${unprocessedSourceCount === 1 ? '' : 's'}`
                : 'Compile \u2014 process sources'
          }
        />
      </div>
      <div ref={agentFlyoutRef} style={{ position: 'relative' }}>
        <div className="canvas-toolbtn-wrap">
          <button
            onClick={async () => {
              if (agentFlyoutOpen) {
                setAgentFlyoutOpen(false)
                return
              }
              const listed = await window.api.actions.list()
              setLoadedActions(listed as ActionDefinition[])
              setAgentFlyoutOpen(true)
            }}
            className="canvas-toolbtn"
            data-testid="canvas-actions"
            aria-label="Actions"
            aria-haspopup="menu"
            aria-expanded={agentFlyoutOpen}
          >
            <svg
              width={14}
              height={14}
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="8" cy="8" r="6" />
              <path d="M8 5v6M5 8h6" />
            </svg>
          </button>
          <Tip label="Actions" />
        </div>
        {agentFlyoutOpen && (
          <ActionMenu
            actions={loadedActions}
            selectedCount={sidebarSelectedCount}
            scopeLabel={scopeLabel}
            onSelect={(id) => {
              setAgentFlyoutOpen(false)
              onActionSelect(id)
            }}
            onClose={() => setAgentFlyoutOpen(false)}
          />
        )}
      </div>

      <div className="canvas-toolrail__divider" />

      {/* FRAMES: spatial bookmarks */}
      <div className="flex w-full flex-col items-center gap-1" style={{ padding: '2px 0' }}>
        {[1, 2, 3, 4, 5].map((slot) => {
          const slotKey = String(slot)
          const filled = slotKey in focusFrames
          return (
            <button
              key={slot}
              onClick={(e) => {
                const store = useCanvasStore.getState()
                if (e.altKey && filled) {
                  store.clearFocusFrame(slotKey)
                } else {
                  store.jumpToFocusFrame(slotKey)
                }
              }}
              title={
                filled
                  ? `Focus Frame ${slot} — ⌘${slot} jump, ⇧⌘${slot} overwrite, ⌥click clear`
                  : `Focus Frame ${slot} — ⇧⌘${slot} to save`
              }
              aria-label={filled ? `Jump to focus frame ${slot}` : `Focus frame ${slot} (empty)`}
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                border: `1.5px solid ${colors.text.muted}`,
                backgroundColor: filled ? colors.text.muted : 'transparent',
                cursor: 'pointer',
                padding: 0
              }}
            />
          )
        })}
      </div>

      <div className="canvas-toolrail__divider" />

      {/* DESTRUCTIVE: burn it down */}
      <div className="canvas-toolbtn-wrap">
        <button
          onClick={() => {
            if (clearEnabled) onClear()
          }}
          className="canvas-toolbtn"
          disabled={!clearEnabled}
          data-testid="canvas-clear"
          aria-label="Clear canvas"
          style={{
            color: colors.text.secondary,
            opacity: clearEnabled ? 1 : 0.4,
            cursor: clearEnabled ? 'pointer' : 'not-allowed'
          }}
          onMouseEnter={(e) => {
            if (clearEnabled) e.currentTarget.style.color = '#ef4444'
          }}
          onMouseLeave={(e) => {
            if (clearEnabled) e.currentTarget.style.color = colors.text.secondary
          }}
        >
          <svg
            width={14}
            height={14}
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2.5 4 L11.5 4" />
            <path d="M5.5 4 L5.5 2.5 L8.5 2.5 L8.5 4" />
            <path d="M4 4 L4.5 12 L9.5 12 L10 4" />
            <path d="M6 6.5 L6 10" />
            <path d="M8 6.5 L8 10" />
          </svg>
        </button>
        <Tip label="Clear canvas" />
      </div>
    </div>
  )
}
