import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { colors, typography } from '../../design/tokens'
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
import { useVaultStore } from '../../store/vault-store'
import { LazyCards } from './card-registry'
import { CardShellSkeleton } from './CardShellSkeleton'
import { CardLodPreview } from './CardLodPreview'
import { EdgeLayer } from './EdgeLayer'
import { ConnectionDragOverlay } from './ConnectionDragOverlay'
import { CommandStack } from './canvas-commands'
import { saveCanvas } from './canvas-io'
import { CanvasToolbar } from './CanvasToolbar'
import { CanvasMinimap } from './CanvasMinimap'
import { ZoomIndicator } from './ZoomIndicator'
import { EdgeDots } from './EdgeDots'
import { ImportPalette } from './ImportPalette'
import { inferLanguage, type DragFileData } from './file-drop-utils'
import { useViewportCulling } from './use-canvas-culling'
import { getLodLevel } from './use-canvas-lod'
import { findOpenPosition } from './canvas-layout'
import { CanvasSplitEditor } from './CanvasSplitEditor'
import { useTabStore } from '../../store/tab-store'

/** Draggable divider + editor panel. Separate component to isolate drag
 *  state from CanvasView and prevent canvas DOM remounts. */
function SplitDividerAndPanel({ filePath }: { readonly filePath: string }) {
  const [width, setWidth] = useState(480)
  const dragging = useRef(false)

  const handleMouseDown = useCallback(() => {
    dragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const fromRight = window.innerWidth - e.clientX
      setWidth(Math.max(250, Math.min(fromRight, window.innerWidth - 500)))
    }

    const onUp = () => {
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  return (
    <>
      <div className="panel-divider" onMouseDown={handleMouseDown} />
      <div style={{ width, flexShrink: 0 }} className="h-full overflow-hidden">
        <CanvasSplitEditor filePath={filePath} />
      </div>
    </>
  )
}

export function CanvasView(): React.ReactElement {
  const nodes = useCanvasStore((s) => s.nodes)
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
  const rawFileCount = useVaultStore((s) => {
    const total = s.artifacts.length
    if (total === 0) return 0
    return s.artifacts.filter(
      (a) =>
        a.connections.length === 0 &&
        a.clusters_with.length === 0 &&
        a.tensions_with.length === 0 &&
        a.related.length === 0 &&
        a.tags.length === 0
    ).length
  })

  const vaultPath = useVaultStore((s) => s.vaultPath)
  const loadCanvas = useCanvasStore((s) => s.loadCanvas)
  const activeTabId = useTabStore((s) => s.activeTabId)

  // Ensure a canvas file exists so autosave can persist terminal session IDs.
  // Without a file, terminal cards vanish on restart.
  const didEnsureCanvas = useRef(false)
  useEffect(() => {
    if (didEnsureCanvas.current || filePath || !vaultPath) return
    didEnsureCanvas.current = true

    void (async () => {
      const defaultPath = `${vaultPath}/Untitled.canvas`
      try {
        const exists = await window.api.fs.fileExists(defaultPath)
        if (exists) {
          const raw = await window.api.fs.readFile(defaultPath)
          const { deserializeCanvas } = await import('./canvas-io')
          loadCanvas(defaultPath, deserializeCanvas(raw))
        } else {
          const { createCanvasFile } = await import('@shared/canvas-types')
          const data = createCanvasFile()
          await window.api.fs.writeFile(defaultPath, JSON.stringify(data, null, 2))
          loadCanvas(defaultPath, data)
        }
      } catch {
        // Non-fatal: canvas works without persistence
      }
    })()
  }, [filePath, vaultPath, loadCanvas])

  // Track container size for viewport culling
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ width: 1920, height: 1080 })
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
  const lod = getLodLevel(viewport.zoom)

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
      } else if (e.key === 'l') {
        // CMD+L: apply default tile layout (grid-2x2) to viewport center
        e.preventDefault()
        const vp = useCanvasStore.getState().viewport
        const w = containerRef.current?.clientWidth ?? 1920
        const h = containerRef.current?.clientHeight ?? 1080
        const centerX = (-vp.x + w / 2) / vp.zoom
        const centerY = (-vp.y + h / 2) / vp.zoom
        useCanvasStore.getState().applyTileLayout('grid-2x2', { x: centerX, y: centerY })
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
        />
        <CanvasSurface
          onContextMenu={handleContextMenu}
          onBackgroundClick={handleBackgroundClick}
          onFileDrop={handleFileDrop}
        >
          <EdgeLayer />
          {visibleNodes.map((node) => {
            // Terminal cards always render at full LOD to preserve PTY sessions
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

        <ConnectionDragOverlay />

        {nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[1]">
            <p
              style={{
                fontSize: 12,
                fontFamily: typography.fontFamily.mono,
                color: colors.text.muted,
                letterSpacing: '0.04em',
                marginTop: -60
              }}
            >
              drop files to begin
              <span style={{ opacity: 0.4, margin: '0 10px' }}>|</span>
              <span style={{ opacity: 0.6 }}>Cmd+G</span>
            </p>
          </div>
        )}

        <ZoomIndicator />

        <EdgeDots containerWidth={containerSize.width} containerHeight={containerSize.height} />

        {/* Hint: files need enrichment */}
        {rawFileCount > 0 && (
          <div className="absolute inset-0 flex items-end justify-center z-10 pointer-events-none pb-14">
            <div
              className="text-center px-4 py-2 rounded-full"
              style={{
                backgroundColor: 'rgba(14, 14, 18, 0.92)',
                backdropFilter: 'blur(8px)',
                border: '1px solid var(--color-border-default)'
              }}
            >
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {rawFileCount} file{rawFileCount !== 1 ? 's' : ''} without metadata
              </span>
              <span
                className="text-xs mx-2"
                style={{ color: 'var(--color-text-muted)', opacity: 0.4 }}
              >
                |
              </span>
              <span className="text-xs" style={{ color: 'var(--color-text-muted)', opacity: 0.7 }}>
                /connect-vault
              </span>
            </div>
          </div>
        )}

        <CanvasMinimap
          containerWidth={containerSize.width}
          containerHeight={containerSize.height}
        />

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
            if (!menuNode || menuNode.type !== 'note') return null
            const menuFilePath = menuNode.content
            const { graph, fileToId, artifacts } = useVaultStore.getState()
            return (
              <CardContextMenu
                x={cardContextMenu.x}
                y={cardContextMenu.y}
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
                  }
                  setCardContextMenu(null)
                }}
                onOpenInEditor={() => {
                  useCanvasStore.getState().openSplit(menuFilePath)
                  setCardContextMenu(null)
                }}
                onCopyPath={() => {
                  navigator.clipboard.writeText(menuFilePath)
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
