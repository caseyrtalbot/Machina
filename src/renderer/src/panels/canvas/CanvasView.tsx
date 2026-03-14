import { useCallback, useState } from 'react'
import { CanvasSurface } from './CanvasSurface'
import { useCanvasStore } from '../../store/canvas-store'
import { createCanvasNode } from '@shared/canvas-types'
import { CanvasContextMenu } from './CanvasContextMenu'
import { colors } from '../../design/tokens'

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

  return (
    <div className="h-full relative">
      <CanvasSurface
        onDoubleClick={handleDoubleClick}
        onBackgroundClick={handleBackgroundClick}
      >
        {/* NodeLayer and EdgeLayer will be added in subsequent tasks */}
        {nodes.map((node) => (
          <div
            key={node.id}
            data-canvas-node
            className="absolute rounded-lg border"
            style={{
              left: node.position.x,
              top: node.position.y,
              width: node.size.width,
              height: node.size.height,
              backgroundColor: colors.bg.surface,
              borderColor: colors.border.default
            }}
          >
            <div
              className="px-3 py-2 text-xs font-medium border-b"
              style={{ color: colors.text.secondary, borderColor: colors.border.subtle }}
            >
              {node.type}
            </div>
            <div className="p-3 text-sm" style={{ color: colors.text.primary }}>
              {node.content || 'Empty card'}
            </div>
          </div>
        ))}
      </CanvasSurface>

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
