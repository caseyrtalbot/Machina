import { memo, useCallback } from 'react'
import { useCanvasStore } from '../../store/canvas-store'
import { colors, borderRadius } from '../../design/tokens'
import { CARD_TYPE_INFO, type CanvasNode } from '@shared/canvas-types'
import { getCardTypeColor } from './canvas-colors'

interface CardLodPreviewProps {
  node: CanvasNode
}

/**
 * Lightweight LOD renderer for zoomed-out views.
 * Colored rectangle with a type label — no editor, PTY, or image decoder.
 */
function CardLodPreviewInner({ node }: CardLodPreviewProps) {
  const setSelection = useCanvasStore((s) => s.setSelection)
  const toggleSelection = useCanvasStore((s) => s.toggleSelection)
  const isSelected = useCanvasStore((s) => s.selectedNodeIds.has(node.id))

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (e.shiftKey) {
        toggleSelection(node.id)
      } else {
        setSelection(new Set([node.id]))
      }
    },
    [node.id, setSelection, toggleSelection]
  )

  const color = getCardTypeColor(node.type)
  const info = CARD_TYPE_INFO[node.type]

  return (
    <div
      data-canvas-node
      className="absolute flex items-start"
      style={{
        left: node.position.x,
        top: node.position.y,
        width: node.size.width,
        height: node.size.height,
        backgroundColor: color,
        opacity: 0.15,
        borderRadius: borderRadius.card,
        border: isSelected ? `2px solid ${colors.accent.default}` : `1px solid ${color}`
      }}
      onClick={handleClick}
    >
      <span
        className="text-xs font-medium truncate px-2 py-1"
        style={{ color: colors.text.primary, opacity: 1 }}
      >
        {info?.label ?? node.type}
      </span>
    </div>
  )
}

export const CardLodPreview = memo(CardLodPreviewInner, (prev, next) => prev.node === next.node)
