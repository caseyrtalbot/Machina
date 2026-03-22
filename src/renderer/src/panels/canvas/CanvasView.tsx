import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
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
import { useEditorStore } from '../../store/editor-store'
import { useViewStore } from '../../store/view-store'
import { LazyCards } from './card-registry'
import { CardShellSkeleton } from './CardShellSkeleton'
import { CardLodPreview } from './CardLodPreview'
import { EdgeLayer } from './EdgeLayer'
import { ConnectionDragOverlay } from './ConnectionDragOverlay'
import { CommandStack } from './canvas-commands'
import { saveCanvas } from './canvas-io'
import { CanvasToolbar } from './CanvasToolbar'
import { CanvasMinimap } from './CanvasMinimap'
import { ImportPalette } from './ImportPalette'
import { inferLanguage, type DragFileData } from './file-drop-utils'
import { useViewportCulling } from './use-canvas-culling'
import { getLodLevel } from './use-canvas-lod'
import { findOpenPosition } from './canvas-layout'

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

  // Performance: only render nodes visible in the viewport
  const visibleNodes = useViewportCulling(nodes, viewport, containerSize)
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

  const handleDoubleClick = useCallback(
    (canvasX: number, canvasY: number, screenX: number, screenY: number) => {
      setContextMenu({ x: screenX, y: screenY, canvasX, canvasY })
    },
    []
  )

  const handleBackgroundClick = useCallback(() => {
    clearSelection()
    setContextMenu(null)
    setCardContextMenu(null)
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
            const language = inferLanguage(file.path)
            const filename = file.path.split('/').pop() ?? ''
            let content = ''
            try {
              content = await window.api.fs.readFile(file.path)
            } catch {
              // File unreadable; create card with empty content
            }
            node = createCanvasNode('code', pos, { content, metadata: { language, filename } })
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

      // Escape clears focus
      if (e.key === 'Escape') {
        useCanvasStore.getState().setFocusedCard(null)
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
    if (!filePath || !isDirty) return
    const timer = setTimeout(async () => {
      await saveCanvas(filePath, toCanvasFile())
      markSaved()
    }, 500)
    return () => clearTimeout(timer)
  }, [filePath, isDirty, toCanvasFile, markSaved])

  return (
    <div ref={containerRef} className="h-full relative">
      {/* eslint-disable react-hooks/refs -- commandStack is a stable ref that doesn't change between renders */}
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
      {/* eslint-enable react-hooks/refs */}
      <CanvasSurface
        onDoubleClick={handleDoubleClick}
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

      {/* Hint: files need enrichment */}
      {rawFileCount > 0 && (
        <div className="absolute inset-0 flex items-end justify-center z-10 pointer-events-none pb-14">
          <div
            className="text-center px-4 py-2 rounded-full"
            style={{
              backgroundColor: 'rgba(20, 20, 20, 0.85)',
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

      <CanvasMinimap containerWidth={containerSize.width} containerHeight={containerSize.height} />

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
          const menuArtifactId = fileToId[menuFilePath]
          const menuArtifact = artifacts.find((a) => a.id === menuArtifactId)
          const menuTitle =
            menuArtifact?.title ?? menuFilePath.split('/').pop()?.replace('.md', '') ?? 'Note'

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
                useEditorStore.getState().openTab(menuFilePath, menuTitle)
                useViewStore.getState().setContentView('editor')
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
  )
}
