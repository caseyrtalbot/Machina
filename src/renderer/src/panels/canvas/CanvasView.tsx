import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CanvasSurface } from './CanvasSurface'
import { useCanvasStore } from '../../store/canvas-store'
import {
  createCanvasNode,
  getDefaultSize,
  type CanvasNode,
  type CanvasNodeType
} from '@shared/canvas-types'
import { CanvasContextMenu } from './CanvasContextMenu'
import { CardContextMenu } from './CardContextMenu'
import { computeShowConnections } from './show-connections'
import { computeImportViewport } from './import-logic'
import { useVaultStore } from '../../store/vault-store'
import { LazyCards } from './card-registry'
import { CardShellSkeleton } from './CardShellSkeleton'
import { CardLodPreview } from './CardLodPreview'
import { EdgeLayer } from './EdgeLayer'
import { ConnectionDragOverlay } from './ConnectionDragOverlay'
import { CommandStack } from './canvas-commands'
import { saveCanvas } from './canvas-io'
import { TE_DIR } from '@shared/constants'
import { CanvasToolbar } from './CanvasToolbar'
import { CanvasActionBar } from './CanvasActionBar'
import { CanvasMinimap } from './CanvasMinimap'
import { ZoomIndicator } from './ZoomIndicator'
import { EdgeDots } from './EdgeDots'
import { ImportPalette } from './ImportPalette'
import { TerminalDock } from './TerminalDock'
import { ClusterLabels } from './ClusterLabels'
import { inferLanguage, type DragFileData } from './file-drop-utils'
import { useViewportCulling } from './use-canvas-culling'
import { getLodLevel } from './use-canvas-lod'
import { findOpenPosition } from './canvas-layout'
import { SplitDividerAndPanel } from './SplitDividerAndPanel'
import { CanvasWelcomeCard, EmptyCanvasHint } from './CanvasEmptyStates'
import { useTabStore } from '../../store/tab-store'
import {
  mapFolderToCanvas,
  cancelFolderMap,
  type FolderMapProgress
} from './folder-map-orchestrator'
import { FolderMapPreviewGhosts, FolderMapPreviewBar } from './FolderMapPreview'
import { SectionOverlay } from './SectionOverlay'
import { OntologyPreview } from './OntologyPreview'
import { useOntologyOrchestrator } from './ontology-orchestrator'
import { useAgentPlanListener } from '../../hooks/use-agent-plan-listener'
import { useAgentOrchestrator } from '../../hooks/use-agent-orchestrator'
import { buildScopeContext } from '@shared/action-types'
import { generateClaudeMd } from '../../engine/claude-md-template'
import { AgentPreview } from './AgentPreview'
import { computeGhostNodes } from './agent-ghost-layer'
import type { AgentActionName } from '@shared/agent-action-types'
import { applyFolderMapPlan } from './folder-map-apply'
import { augmentFolderMapWithVaultSemantics } from './folder-map-semantic'
import {
  buildFolderMapPlan,
  filterCanvasAdditions,
  type CanvasMutationPlan
} from '@shared/canvas-mutation-types'
import { useSidebarSelectionStore } from '../../store/sidebar-selection-store'

const folderMapProgressStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 16,
  left: '50%',
  transform: 'translateX(-50%)',
  padding: '8px 16px',
  borderRadius: '8px',
  background: 'var(--color-bg-elevated)',
  border: '1px solid var(--color-border-subtle)',
  fontSize: '13px',
  color: 'var(--color-text-secondary)',
  zIndex: 10
}

export function CanvasView(): React.ReactElement {
  const nodes = useCanvasStore((s) => s.nodes)
  const pendingFolderMap = useCanvasStore((s) => s.pendingFolderMap)
  const viewport = useCanvasStore((s) => s.viewport)
  const clearSelection = useCanvasStore((s) => s.clearSelection)
  const addNode = useCanvasStore((s) => s.addNode)
  const setViewport = useCanvasStore((s) => s.setViewport)
  const filePath = useCanvasStore((s) => s.filePath)
  const isDirty = useCanvasStore((s) => s.isDirty)
  const toCanvasFile = useCanvasStore((s) => s.toCanvasFile)
  const markSaved = useCanvasStore((s) => s.markSaved)
  const addNodesAndEdges = useCanvasStore((s) => s.addNodesAndEdges)
  const cardContextMenu = useCanvasStore((s) => s.cardContextMenu)
  const setCardContextMenu = useCanvasStore((s) => s.setCardContextMenu)
  const splitFilePath = useCanvasStore((s) => s.splitFilePath)
  const selectedNodeIds = useCanvasStore((s) => s.selectedNodeIds)
  const commandStack = useRef(new CommandStack())
  const [containerSize, setContainerSize] = useState({ width: 1920, height: 1080 })
  const [folderMapProgress, setFolderMapProgress] = useState<FolderMapProgress | null>(null)
  const [previewPlan, setPreviewPlan] = useState<CanvasMutationPlan | null>(null)
  const ontology = useOntologyOrchestrator(commandStack)
  const agent = useAgentOrchestrator(commandStack, containerSize)
  useAgentPlanListener()
  const rawFileCount = useVaultStore((s) => s.rawFileCount)

  const vaultPath = useVaultStore((s) => s.vaultPath)
  const artifacts = useVaultStore((s) => s.artifacts)
  const graph = useVaultStore((s) => s.graph)
  const fileToId = useVaultStore((s) => s.fileToId)
  const artifactPathById = useVaultStore((s) => s.artifactPathById)
  const loadCanvas = useCanvasStore((s) => s.loadCanvas)
  const activeTabId = useTabStore((s) => s.activeTabId)

  // Load existing default canvas from .machina/ if one exists.
  // The default canvas is a system file — never pollutes the vault root.
  const didLoadCanvas = useRef(false)
  useEffect(() => {
    if (didLoadCanvas.current || filePath || !vaultPath) return
    didLoadCanvas.current = true

    void (async () => {
      const defaultPath = `${vaultPath}/${TE_DIR}/canvas.json`
      try {
        const exists = await window.api.fs.fileExists(defaultPath)
        if (exists) {
          const raw = await window.api.fs.readFile(defaultPath)
          const { deserializeCanvas } = await import('./canvas-io')
          loadCanvas(defaultPath, deserializeCanvas(raw))
        }
        // If no file exists, canvas works in-memory until first content mutation
      } catch {
        // Non-fatal: canvas works without persistence
      }
    })()
  }, [filePath, vaultPath, loadCanvas])

  // Lazily create the canvas file on first content mutation (node or edge added).
  // Viewport-only changes do not create the file.
  const didEnsureFile = useRef(false)
  const edges = useCanvasStore((s) => s.edges)
  const hasContent = nodes.length > 0 || edges.length > 0
  useEffect(() => {
    if (didEnsureFile.current || filePath || !vaultPath || !hasContent) return
    didEnsureFile.current = true

    void (async () => {
      const defaultPath = `${vaultPath}/${TE_DIR}/canvas.json`
      try {
        const { createCanvasFile } = await import('@shared/canvas-types')
        const data = createCanvasFile()
        await window.api.fs.writeFile(defaultPath, JSON.stringify(data, null, 2))
        loadCanvas(defaultPath, { ...data, ...toCanvasFile() })
      } catch {
        // Non-fatal
      }
    })()
  }, [filePath, vaultPath, hasContent, loadCanvas, toCanvasFile])

  // Track container size for viewport culling
  const containerRef = useRef<HTMLDivElement>(null)
  const [importOpen, setImportOpen] = useState(false)

  // Track which filePath has already been auto-centered so we don't fight user panning
  const centeredForFileRef = useRef<string | null>(null)

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

  // Keep content centered when the container resizes (window resize, sidebar toggle)
  const prevSizeRef = useRef(containerSize)
  useEffect(() => {
    const prev = prevSizeRef.current
    prevSizeRef.current = containerSize
    // Skip the initial mount (before we have real dimensions)
    if (prev.width === 1920 && prev.height === 1080) return
    // Skip zero-size transitions (display:none, unmounting)
    if (containerSize.width === 0 || containerSize.height === 0) return
    if (prev.width === 0 || prev.height === 0) return
    const dw = containerSize.width - prev.width
    const dh = containerSize.height - prev.height
    if (dw === 0 && dh === 0) return
    const { x, y, zoom } = useCanvasStore.getState().viewport
    setViewport({ x: x + dw / 2, y: y + dh / 2, zoom })
  }, [containerSize, setViewport])

  // Auto-center viewport when a canvas first loads
  useEffect(() => {
    if (!filePath) return
    // Only run once per filePath
    if (centeredForFileRef.current === filePath) return

    // Wait until the container has been measured by ResizeObserver
    const el = containerRef.current
    if (!el) return
    const width = el.clientWidth
    const height = el.clientHeight
    if (width === 0 || height === 0) return

    centeredForFileRef.current = filePath

    const zoom = useCanvasStore.getState().viewport.zoom
    const currentNodes = useCanvasStore.getState().nodes

    if (currentNodes.length === 0) {
      // Center on origin
      setViewport({ x: width / 2, y: height / 2, zoom })
      return
    }

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const node of currentNodes) {
      minX = Math.min(minX, node.position.x)
      minY = Math.min(minY, node.position.y)
      maxX = Math.max(maxX, node.position.x + node.size.width)
      maxY = Math.max(maxY, node.position.y + node.size.height)
    }

    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2
    setViewport({
      x: width / 2 - centerX * zoom,
      y: height / 2 - centerY * zoom,
      zoom
    })
  }, [filePath, containerSize, setViewport])

  // Build protected set: selected nodes + the card open in split editor
  const protectedIds = useMemo(() => {
    const ids = new Set(selectedNodeIds)
    if (splitFilePath) {
      for (const n of nodes) {
        if (n.content === splitFilePath) ids.add(n.id)
      }
    }
    return ids
  }, [selectedNodeIds, splitFilePath, nodes])

  // Performance: only render nodes visible in the viewport
  const visibleNodes = useViewportCulling(nodes, viewport, containerSize, protectedIds)

  const addNodeWithUndo = useCallback(
    (node: CanvasNode) => {
      commandStack.current.execute({
        execute: () => addNode(node),
        undo: () => useCanvasStore.getState().removeNode(node.id)
      })
    },
    [addNode]
  )

  const handleImportExecute = useCallback((execute: () => void, undo: () => void) => {
    commandStack.current.execute({ execute, undo })
  }, [])

  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    canvasX: number
    canvasY: number
  } | null>(null)

  const handleContextMenu = useCallback(
    (canvasX: number, canvasY: number, screenX: number, screenY: number) => {
      setContextMenu({ x: screenX, y: screenY, canvasX, canvasY })
    },
    []
  )

  const handleBackgroundClick = useCallback(() => {
    clearSelection()
    setContextMenu(null)
    setCardContextMenu(null)
    useCanvasStore.getState().unlockCard()
    useCanvasStore.getState().setFocusedCard(null)
  }, [clearSelection, setCardContextMenu])

  const handleAddCard = useCallback(
    (type: CanvasNodeType, overrides?: Partial<Pick<CanvasNode, 'content' | 'metadata'>>) => {
      if (!contextMenu) return
      const node = createCanvasNode(
        type,
        { x: contextMenu.canvasX, y: contextMenu.canvasY },
        overrides
      )
      addNodeWithUndo(node)
      setContextMenu(null)
    },
    [contextMenu, addNodeWithUndo]
  )

  const handleFileDrop = useCallback(
    async (canvasX: number, canvasY: number, dataJson: string) => {
      let files: DragFileData[]
      try {
        const parsed = JSON.parse(dataJson)
        files = Array.isArray(parsed) ? parsed : [parsed]
      } catch {
        return
      }

      // Grid layout with collision avoidance against existing cards
      const GAP = 24
      const COLS = Math.min(files.length, 3)

      // Track nodes placed in this batch so they avoid each other
      const placedInBatch: CanvasNode[] = []
      const allExisting = [...nodes]

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const col = i % COLS
        const row = Math.floor(i / COLS)
        const size = getDefaultSize(file.type)
        const rawX = canvasX + col * (size.width + GAP)
        const rawY = canvasY + row * (size.height + GAP)
        const pos = findOpenPosition({ x: rawX, y: rawY }, size, [...allExisting, ...placedInBatch])

        let node: CanvasNode
        switch (file.type) {
          case 'note': {
            node = createCanvasNode('note', pos, { content: file.path })
            break
          }
          case 'image': {
            const alt = file.path.split('/').pop() ?? ''
            node = createCanvasNode('image', pos, { metadata: { src: file.path, alt } })
            break
          }
          case 'pdf': {
            node = createCanvasNode('pdf', pos, {
              metadata: { src: file.path, pageCount: 0, currentPage: 1 }
            })
            break
          }
          case 'code': {
            // Create file-view card (read-only live monitor) instead of inline code card
            const language = inferLanguage(file.path)
            node = createCanvasNode('file-view', pos, {
              content: file.path,
              metadata: { language, previousLineCount: 0, modified: false }
            })
            break
          }
          default: {
            let content = ''
            try {
              content = await window.api.fs.readFile(file.path)
            } catch {
              // File unreadable; create card with empty content
            }
            node = createCanvasNode('text', pos, { content })
            break
          }
        }
        placedInBatch.push(node)
        addNodeWithUndo(node)
      }
    },
    [addNodeWithUndo, nodes]
  )

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Focus Frames: Cmd+1-5 jump, Cmd+Shift+1-5 save
      if (e.metaKey && e.key >= '1' && e.key <= '5') {
        e.preventDefault()
        if (e.shiftKey) {
          useCanvasStore.getState().saveFocusFrame(e.key)
        } else {
          useCanvasStore.getState().jumpToFocusFrame(e.key)
        }
        return
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const { selectedEdgeId, removeEdge, selectedNodeIds, removeNode, focusedTerminalId } =
          useCanvasStore.getState()
        // Don't delete while editing text or terminal is focused
        if (focusedTerminalId) return
        if (document.activeElement?.tagName === 'TEXTAREA') return
        if (document.activeElement?.tagName === 'INPUT') return
        if ((document.activeElement as HTMLElement)?.isContentEditable) return
        if (document.activeElement?.closest('.cm-editor')) return

        if (selectedEdgeId) {
          removeEdge(selectedEdgeId)
        }
        if (selectedNodeIds.size > 0) {
          for (const id of selectedNodeIds) {
            removeNode(id)
          }
        }
      }

      // J/K spatial card cycling
      if (e.key === 'j' || e.key === 'k') {
        // Guard: don't fire in terminals, text inputs, or rich editors
        if (useCanvasStore.getState().focusedTerminalId) return
        if (document.activeElement?.tagName === 'TEXTAREA') return
        if (document.activeElement?.tagName === 'INPUT') return
        if ((document.activeElement as HTMLElement)?.isContentEditable) return

        e.preventDefault()
        if (e.key === 'j') {
          useCanvasStore.getState().focusNextCard()
        } else {
          useCanvasStore.getState().focusPrevCard()
        }
      }

      // Escape clears focus lock first, then keyboard focus
      if (e.key === 'Escape') {
        const { lockedCardId } = useCanvasStore.getState()
        if (lockedCardId) {
          useCanvasStore.getState().unlockCard()
        } else {
          useCanvasStore.getState().setFocusedCard(null)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.metaKey) return
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        commandStack.current.undo()
      } else if (e.key === 'z' && e.shiftKey) {
        e.preventDefault()
        commandStack.current.redo()
      } else if (e.key === 'g') {
        if (
          !containerRef.current?.contains(document.activeElement) &&
          document.activeElement !== document.body
        )
          return
        e.preventDefault()
        setImportOpen(true)
      } else if (e.key === 'e' && e.shiftKey) {
        // CMD+Shift+E: toggle split editor
        e.preventDefault()
        const { splitFilePath: sp } = useCanvasStore.getState()
        if (sp) {
          useCanvasStore.getState().closeSplit()
        } else {
          // Open split with the focused card's file if available
          const focusedId = useCanvasStore.getState().focusedCardId
          const focusedNode = focusedId
            ? useCanvasStore.getState().nodes.find((n) => n.id === focusedId)
            : null
          if (focusedNode?.content) {
            useCanvasStore.getState().openSplit(focusedNode.content)
          }
        }
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault()
        const vp = useCanvasStore.getState().viewport
        const w = containerRef.current?.clientWidth ?? 1920
        const h = containerRef.current?.clientHeight ?? 1080
        const centerX = (-vp.x + w / 2) / vp.zoom
        const centerY = (-vp.y + h / 2) / vp.zoom
        if (e.shiftKey) {
          // CMD+Shift+L: semantic organize by topic
          const { artifacts, graph, fileToId } = useVaultStore.getState()
          const fileToIdMap = new Map(Object.entries(fileToId))
          const artMap = new Map(artifacts.map((a) => [a.id, { id: a.id, tags: a.tags }]))
          useCanvasStore
            .getState()
            .applySemanticLayout({ x: centerX, y: centerY }, fileToIdMap, artMap, graph.edges)
        } else {
          // CMD+L: grid-2x2 tile layout
          useCanvasStore.getState().applyTileLayout('grid-2x2', { x: centerX, y: centerY })
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Register centerOnNode bridge so external callers (e.g. command palette) can
  // focus a specific card by ID with smooth viewport centering.
  useEffect(() => {
    useCanvasStore.getState().setCenterOnNode((nodeId) => {
      const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId)
      if (!node) return
      const cx = node.position.x + node.size.width / 2
      const cy = node.position.y + node.size.height / 2
      const zoom = useCanvasStore.getState().viewport.zoom
      useCanvasStore.getState().setViewport({
        x: containerSize.width / 2 - cx * zoom,
        y: containerSize.height / 2 - cy * zoom,
        zoom
      })
      useCanvasStore.getState().setSelection(new Set([nodeId]))
    })
    return () => useCanvasStore.getState().setCenterOnNode(null)
  }, [containerSize])

  // Auto-save debounce
  useEffect(() => {
    if (activeTabId !== 'canvas' || !filePath || !isDirty) return
    const timer = setTimeout(async () => {
      await saveCanvas(filePath, toCanvasFile())
      markSaved()
    }, 500)
    return () => clearTimeout(timer)
  }, [activeTabId, filePath, isDirty, toCanvasFile, markSaved])

  // Agent palette: listen for agent-action-trigger events from command palette
  useEffect(() => {
    const handler = (e: Event) => {
      const action = (e as CustomEvent<{ action: AgentActionName }>).detail.action
      agent.trigger(action)
    }
    window.addEventListener('agent-action-trigger', handler)
    return () => window.removeEventListener('agent-action-trigger', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- agent.trigger is a stable useCallback
  }, [agent.trigger])

  // Folder-map: trigger analysis when a folder path is set.
  // We capture the path, clear pendingFolderMap immediately, and run the orchestrator.
  // Cancel only runs on unmount via a separate effect, NOT on dependency changes,
  // because clearing pendingFolderMap to null re-fires this effect and the cleanup
  // would cancel the in-flight operation.
  useEffect(() => {
    return () => cancelFolderMap()
  }, [])

  useEffect(() => {
    if (!pendingFolderMap) return
    const path = pendingFolderMap
    useCanvasStore.getState().setPendingFolderMap(null)

    void (async () => {
      try {
        const startState = useCanvasStore.getState()
        const result = await mapFolderToCanvas(path, startState.nodes, setFolderMapProgress)
        if (result) {
          const semanticResult = augmentFolderMapWithVaultSemantics({
            rootPath: path,
            nodes: result.nodes,
            edges: result.edges,
            graph,
            artifacts,
            fileToId,
            artifactPathById
          })
          const currentState = useCanvasStore.getState()
          const additions = filterCanvasAdditions(
            [...semanticResult.nodes],
            [...semanticResult.edges],
            currentState.nodes,
            currentState.edges
          )
          if (additions.nodes.length === 0 && additions.edges.length === 0) {
            setPreviewPlan(null)
            return
          }

          const plan = buildFolderMapPlan(
            `fmo_${Date.now().toString(36)}`,
            additions.nodes,
            additions.edges,
            result.snapshot.skippedCount,
            result.snapshot.unresolvedRefs.length
          )
          setPreviewPlan(plan)
        }
      } catch (err) {
        console.error('Folder map failed:', err)
      } finally {
        setFolderMapProgress(null)
      }
    })()
  }, [pendingFolderMap, graph, artifacts, fileToId, artifactPathById])

  // Folder-map: apply plan to canvas with undo support
  const handleApplyPlan = useCallback(() => {
    if (!previewPlan) return
    applyFolderMapPlan(previewPlan, commandStack.current)
    const addNodeOps = previewPlan.ops.filter((op) => op.type === 'add-node')
    if (addNodeOps.length > 50) {
      const allNodes = useCanvasStore.getState().nodes
      const canvasEl = document.querySelector('[data-canvas-surface]')
      if (canvasEl) {
        const vp = computeImportViewport(allNodes, canvasEl.clientWidth, canvasEl.clientHeight)
        useCanvasStore.getState().setViewport(vp)
      }
    }
    setPreviewPlan(null)
  }, [previewPlan])

  const handleCancelPlan = useCallback(() => {
    setPreviewPlan(null)
  }, [])

  const handleAction = useCallback(async (actionId: string) => {
    const vp = useVaultStore.getState().vaultPath
    if (!vp) return

    // 1. Read skill.md + action body via IPC
    const [skillContent, actionResult] = await Promise.all([
      window.api.fs.readFile(`${vp}/${TE_DIR}/skill.md`).catch(() => ''),
      window.api.actions.read(actionId)
    ])

    if ('error' in actionResult) {
      console.error('Action read failed:', actionResult.error)
      return
    }

    // 2. Build scope context from sidebar selection
    const selectedPaths = useSidebarSelectionStore.getState().selectedPaths
    const scopeContext = buildScopeContext(selectedPaths, vp)

    // 3. Assemble prompt
    const assembledPrompt = [skillContent, actionResult.body, scopeContext]
      .filter(Boolean)
      .join('\n\n---\n\n')

    // 4. Ensure CLAUDE.md exists (same as Claude Live card)
    const claudeMdPath = `${vp}/CLAUDE.md`
    const exists = await window.api.fs.fileExists(claudeMdPath)
    if (!exists) {
      const vaultName = vp.split('/').pop() ?? 'Vault'
      await window.api.fs.writeFile(claudeMdPath, generateClaudeMd(vaultName))
    }

    // 5. Write prompt + launcher script to files for a clean terminal experience
    const promptId = Date.now().toString(36)
    const promptPath = `${vp}/${TE_DIR}/action-prompt-${promptId}.txt`
    const scriptPath = `${vp}/${TE_DIR}/action-launch-${promptId}.sh`
    await window.api.fs.writeFile(promptPath, assembledPrompt)

    // Build a scope summary for the header line
    const scopeFiles = [...selectedPaths].map((p) =>
      p.startsWith(vp) ? p.slice(vp.length + 1) : p
    )
    const scopeSummary =
      scopeFiles.length > 0 ? scopeFiles.map((f) => f.split('/').pop()).join(', ') : 'entire vault'

    const script = [
      '#!/bin/bash',
      'clear',
      `printf "\\033[1m${actionResult.definition.name}\\033[0m  ${scopeSummary}\\n\\n"`,
      `exec claude --append-system-prompt "$(cat '${promptPath}')" \\`,
      '  --dangerously-skip-permissions \\',
      '  --allowedTools Read,Write,Edit,Glob,Grep,Bash \\',
      '  --initial-prompt "Begin."'
    ].join('\n')
    await window.api.fs.writeFile(scriptPath, script)

    // 6. Spawn terminal card that runs the launcher script
    const viewport = useCanvasStore.getState().viewport
    const node = createCanvasNode(
      'terminal',
      { x: -viewport.x + 200, y: -viewport.y + 100 },
      {
        metadata: {
          initialCommand: `bash '${scriptPath}'`,
          initialCwd: vp,
          actionId,
          actionName: actionResult.definition.name
        }
      }
    )
    useCanvasStore.getState().addNode(node)
  }, [])

  const ontologyGroups = ontology.pendingSnapshot
    ? Object.values(ontology.pendingSnapshot.groupsById)
    : []
  const ontologyGroupCount = ontologyGroups.filter((g) => g.parentGroupId === null).length
  const ontologyCardCount = ontologyGroups.reduce((sum, g) => sum + g.cardIds.length, 0)

  return (
    <div className="flex h-full w-full overflow-hidden">
      <div ref={containerRef} className="h-full relative" style={{ flex: 1, minWidth: 0 }}>
        <CanvasToolbar
          canUndo={commandStack.current.canUndo()}
          canRedo={commandStack.current.canRedo()}
          onUndo={() => commandStack.current.undo()}
          onRedo={() => commandStack.current.redo()}
          onAddCard={() => {
            const vp = useCanvasStore.getState().viewport
            const node = createCanvasNode('text', {
              x: -vp.x / vp.zoom + 200,
              y: -vp.y / vp.zoom + 200
            })
            addNodeWithUndo(node)
          }}
          onOpenImport={() => setImportOpen(true)}
          onOrganize={ontology.startOrganize}
          organizePhase={ontology.phase}
          onActionSelect={handleAction}
        />
        <CanvasActionBar
          onTriggerAction={agent.trigger}
          onStop={agent.cancel}
          activeAction={agent.activeAction}
          phase={agent.phase}
        />
        <CanvasSurface
          onContextMenu={handleContextMenu}
          onBackgroundClick={handleBackgroundClick}
          onFileDrop={handleFileDrop}
        >
          <EdgeLayer />
          {visibleNodes.map((node) => {
            const nodeLod = getLodLevel(viewport.zoom, node.type)
            // Terminal cards always render at full LOD to preserve PTY sessions
            if ((nodeLod === 'dot' || nodeLod === 'preview') && node.type !== 'terminal') {
              return <CardLodPreview key={node.id} node={node} lod={nodeLod} />
            }
            const Card = LazyCards[node.type]
            if (!Card) return null
            return (
              <Suspense key={node.id} fallback={<CardShellSkeleton node={node} />}>
                <Card node={node} />
              </Suspense>
            )
          })}
          {previewPlan && <FolderMapPreviewGhosts plan={previewPlan} />}
          {agent.phase === 'preview' && agent.pendingPlan && (
            <>
              {computeGhostNodes(agent.pendingPlan, nodes).map((ghost) => (
                <div
                  key={`ghost-${ghost.id}`}
                  style={{
                    position: 'absolute',
                    left: ghost.position.x,
                    top: ghost.position.y,
                    width: ghost.size.width,
                    height: ghost.size.height,
                    backgroundColor: 'rgba(76, 175, 80, 0.08)',
                    border: '1px dashed rgba(76, 175, 80, 0.3)',
                    borderRadius: 8,
                    padding: 12,
                    pointerEvents: 'none',
                    overflow: 'hidden',
                    fontSize: 12,
                    color: 'rgba(255, 255, 255, 0.4)'
                  }}
                >
                  {ghost.isMoved ? '\u21A6 moved' : ghost.content.slice(0, 120)}
                </div>
              ))}
            </>
          )}
        </CanvasSurface>

        <SectionOverlay viewport={viewport} />

        {(ontology.phase === 'preview' || ontology.phase === 'error') && (
          <OntologyPreview
            phase={ontology.phase}
            errorMessage={ontology.errorMessage ?? undefined}
            groupCount={ontologyGroupCount}
            cardCount={ontologyCardCount}
            onApply={ontology.applyResult}
            onCancel={ontology.cancel}
          />
        )}

        {(agent.phase === 'computing' || agent.phase === 'preview' || agent.phase === 'error') && (
          <AgentPreview
            phase={agent.phase}
            actionName={agent.activeAction ? `/${agent.activeAction}` : null}
            plan={agent.pendingPlan}
            errorMessage={agent.errorMessage}
            onApply={agent.apply}
            onCancel={agent.cancel}
          />
        )}

        {previewPlan && (
          <FolderMapPreviewBar
            plan={previewPlan}
            onApply={handleApplyPlan}
            onCancel={handleCancelPlan}
          />
        )}

        {folderMapProgress &&
          folderMapProgress.phase !== 'idle' &&
          folderMapProgress.phase !== 'done' && (
            <div style={folderMapProgressStyle}>
              {folderMapProgress.phase === 'error'
                ? `\u26A0 ${folderMapProgress.errorMessage ?? 'Mapping failed'}`
                : `Mapping\u2026 ${folderMapProgress.filesProcessed}/${folderMapProgress.totalFiles} files`}
            </div>
          )}

        <ConnectionDragOverlay />
        {nodes.length === 0 && !vaultPath && <CanvasWelcomeCard />}
        {nodes.length === 0 && vaultPath && <EmptyCanvasHint rawFileCount={rawFileCount} />}
        <ZoomIndicator />
        <EdgeDots containerWidth={containerSize.width} containerHeight={containerSize.height} />
        <ClusterLabels viewport={viewport} />
        <CanvasMinimap
          containerWidth={containerSize.width}
          containerHeight={containerSize.height}
        />
        <TerminalDock containerWidth={containerSize.width} containerHeight={containerSize.height} />

        <ImportPalette
          open={importOpen}
          onClose={() => setImportOpen(false)}
          onImport={handleImportExecute}
          containerWidth={containerSize.width}
          containerHeight={containerSize.height}
        />

        {contextMenu && (
          <CanvasContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onAddCard={handleAddCard}
            onClose={() => setContextMenu(null)}
          />
        )}

        {cardContextMenu &&
          (() => {
            const menuNode = nodes.find((n) => n.id === cardContextMenu.nodeId)
            if (!menuNode) return null
            const isNote = menuNode.type === 'note'
            const menuFilePath = isNote ? menuNode.content : undefined
            const { graph, fileToId, artifacts } = useVaultStore.getState()
            return (
              <CardContextMenu
                x={cardContextMenu.x}
                y={cardContextMenu.y}
                selectedCount={selectedNodeIds.size}
                onAgentAction={(action) => {
                  setCardContextMenu(null)
                  agent.trigger(action)
                }}
                agentBusy={agent.phase !== 'idle'}
                onShowConnections={() => {
                  const { newNodes, newEdges } = computeShowConnections(
                    menuNode,
                    nodes,
                    graph,
                    fileToId,
                    artifacts
                  )
                  if (newNodes.length > 0 || newEdges.length > 0) {
                    commandStack.current.execute({
                      execute: () => addNodesAndEdges(newNodes, newEdges),
                      undo: () => {
                        const store = useCanvasStore.getState()
                        const nodeIds = new Set(newNodes.map((n) => n.id))
                        const edgeIds = new Set(newEdges.map((e) => e.id))
                        useCanvasStore.setState({
                          nodes: store.nodes.filter((n) => !nodeIds.has(n.id)),
                          edges: store.edges.filter((e) => !edgeIds.has(e.id)),
                          isDirty: true
                        })
                      }
                    })
                    // Fit viewport to all cards including new connections
                    const allNodes = [...useCanvasStore.getState().nodes]
                    const vp = computeImportViewport(
                      allNodes,
                      containerSize.width,
                      containerSize.height
                    )
                    setViewport(vp)
                  }
                  setCardContextMenu(null)
                }}
                onOpenInEditor={
                  isNote
                    ? () => {
                        useCanvasStore.getState().openSplit(menuFilePath!)
                        setCardContextMenu(null)
                      }
                    : undefined
                }
                onCopyPath={() => {
                  navigator.clipboard.writeText(menuNode.content)
                  setCardContextMenu(null)
                }}
                onClose={() => setCardContextMenu(null)}
              />
            )
          })()}
      </div>
      {splitFilePath && <SplitDividerAndPanel filePath={splitFilePath} />}
    </div>
  )
}
