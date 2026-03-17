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

export function CanvasView() {
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
        // Support both single file and array
        files = Array.isArray(parsed) ? parsed : [parsed]
      } catch {
        return
      }

      const STACK_OFFSET = 20

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const x = canvasX + i * STACK_OFFSET
        const y = canvasY + i * STACK_OFFSET

        if (file.type === 'note') {
          // Vault note: content is the file path
          const node = createCanvasNode('note', { x, y }, { content: file.path })
          addNodeWithUndo(node)
        } else if (file.type === 'image') {
          // Image: metadata.src is the file path
          const node = createCanvasNode(
            'image',
            { x, y },
            {
              metadata: { src: file.path, alt: file.path.split('/').pop() ?? '' }
            }
          )
          addNodeWithUndo(node)
        } else if (file.type === 'pdf') {
          const node = createCanvasNode(
            'pdf',
            { x, y },
            {
              metadata: { src: file.path, pageCount: 0, currentPage: 1 }
            }
          )
          addNodeWithUndo(node)
        } else if (file.type === 'code') {
          // Code file: read content, set language
          try {
            const content = await window.api.fs.readFile(file.path)
            const language = inferLanguage(file.path)
            const filename = file.path.split('/').pop() ?? ''
            const node = createCanvasNode(
              'code',
              { x, y },
              {
                content,
                metadata: { language, filename }
              }
            )
            addNodeWithUndo(node)
          } catch {
            // Fallback: create empty code card with filename
            const node = createCanvasNode(
              'code',
              { x, y },
              {
                metadata: {
                  language: inferLanguage(file.path),
                  filename: file.path.split('/').pop()
                }
              }
            )
            addNodeWithUndo(node)
          }
        } else {
          // Text fallback
          try {
            const content = await window.api.fs.readFile(file.path)
            const node = createCanvasNode('text', { x, y }, { content })
            addNodeWithUndo(node)
          } catch {
            const node = createCanvasNode('text', { x, y })
            addNodeWithUndo(node)
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
