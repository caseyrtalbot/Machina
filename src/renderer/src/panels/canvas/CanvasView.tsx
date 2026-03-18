import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { CanvasSurface } from './CanvasSurface'
import { useCanvasStore } from '../../store/canvas-store'
import { createCanvasNode, type CanvasNode, type CanvasNodeType } from '@shared/canvas-types'
import { CanvasContextMenu } from './CanvasContextMenu'
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

export function CanvasView(): React.ReactElement {
  const nodes = useCanvasStore((s) => s.nodes)
  const viewport = useCanvasStore((s) => s.viewport)
  const clearSelection = useCanvasStore((s) => s.clearSelection)
  const addNode = useCanvasStore((s) => s.addNode)
  const filePath = useCanvasStore((s) => s.filePath)
  const isDirty = useCanvasStore((s) => s.isDirty)
  const toCanvasFile = useCanvasStore((s) => s.toCanvasFile)
  const markSaved = useCanvasStore((s) => s.markSaved)
  const commandStack = useRef(new CommandStack())

  // Track container size for viewport culling
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ width: 1920, height: 1080 })
  const [importOpen, setImportOpen] = useState(false)

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
  }, [clearSelection])

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

      const STACK_OFFSET = 20

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const x = canvasX + i * STACK_OFFSET
        const y = canvasY + i * STACK_OFFSET
        const pos = { x, y }

        switch (file.type) {
          case 'note': {
            addNodeWithUndo(createCanvasNode('note', pos, { content: file.path }))
            break
          }
          case 'image': {
            const alt = file.path.split('/').pop() ?? ''
            addNodeWithUndo(createCanvasNode('image', pos, { metadata: { src: file.path, alt } }))
            break
          }
          case 'pdf': {
            addNodeWithUndo(
              createCanvasNode('pdf', pos, {
                metadata: { src: file.path, pageCount: 0, currentPage: 1 }
              })
            )
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
            addNodeWithUndo(
              createCanvasNode('code', pos, { content, metadata: { language, filename } })
            )
            break
          }
          default: {
            let content = ''
            try {
              content = await window.api.fs.readFile(file.path)
            } catch {
              // File unreadable; create card with empty content
            }
            addNodeWithUndo(createCanvasNode('text', pos, { content }))
            break
          }
        }
      }
    },
    [addNodeWithUndo]
  )

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
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
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

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

      <ConnectionDragOverlay />

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
    </div>
  )
}
