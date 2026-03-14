import { useCallback, useEffect, useState } from 'react'
import { CanvasSurface } from './CanvasSurface'
import { useCanvasStore } from '../../store/canvas-store'
import { createCanvasNode } from '@shared/canvas-types'
import { CanvasContextMenu } from './CanvasContextMenu'
import { TextCard } from './TextCard'
import { NoteCard } from './NoteCard'
import { TerminalCard } from './TerminalCard'
import { EdgeLayer } from './EdgeLayer'
import { ConnectionDragOverlay } from './ConnectionDragOverlay'

export function CanvasView() {
  const nodes = useCanvasStore((s) => s.nodes)
  const clearSelection = useCanvasStore((s) => s.clearSelection)
  const addNode = useCanvasStore((s) => s.addNode)

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
    (type: 'text' | 'note' | 'terminal') => {
      if (!contextMenu) return
      const node = createCanvasNode(type, {
        x: contextMenu.canvasX,
        y: contextMenu.canvasY
      })
      addNode(node)
      setContextMenu(null)
    },
    [contextMenu, addNode]
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

  return (
    <div className="h-full relative">
      <CanvasSurface onDoubleClick={handleDoubleClick} onBackgroundClick={handleBackgroundClick}>
        <EdgeLayer />
        {nodes.map((node) => {
          switch (node.type) {
            case 'text':
              return <TextCard key={node.id} node={node} />
            case 'note':
              return <NoteCard key={node.id} node={node} />
            case 'terminal':
              return <TerminalCard key={node.id} node={node} />
            default:
              return null
          }
        })}
      </CanvasSurface>

      <ConnectionDragOverlay />

      {contextMenu && (
        <CanvasContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onAddCard={() => handleAddCard('text')}
          onAddNote={() => handleAddCard('note')}
          onAddTerminal={() => handleAddCard('terminal')}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}
