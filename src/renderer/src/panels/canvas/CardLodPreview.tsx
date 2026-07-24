import { memo, useCallback, useRef } from 'react'
import { useCanvas } from './canvas-store-context'
import { colors } from '../../design/tokens'
import { CARD_TYPE_INFO, type CanvasNode } from '@shared/canvas-types'
import { getCardTypeColor } from './canvas-colors'
import { useNodeDrag } from './use-canvas-drag'

interface CardLodPreviewProps {
  node: CanvasNode
}

/** Pointer travel below this (in client px) still counts as a click. */
const CLICK_SLOP_PX = 3

/**
 * Lightweight LOD renderer for zoomed-out views.
 * Colored rectangle with a type label — no editor, PTY, or image decoder.
 * Draggable so coarse rearrangement works below the full-card zoom threshold.
 */
function CardLodPreviewInner({ node }: CardLodPreviewProps) {
  const setSelection = useCanvas((s) => s.setSelection)
  const toggleSelection = useCanvas((s) => s.toggleSelection)
  const isSelected = useCanvas((s) => s.selectedNodeIds.has(node.id))
  const { onDragStart } = useNodeDrag(node.id)
  const pointerDownAt = useRef<{ x: number; y: number } | null>(null)

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      pointerDownAt.current = { x: e.clientX, y: e.clientY }
      onDragStart(e)
    },
    [onDragStart]
  )

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      // A drag ends with a click on the same element; don't let it collapse
      // the selection that was just dragged.
      const down = pointerDownAt.current
      pointerDownAt.current = null
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_SLOP_PX) return
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
      className="canvas-lod-preview"
      style={{
        left: node.position.x,
        top: node.position.y,
        width: node.size.width,
        height: node.size.height,
        backgroundColor: color,
        border: isSelected ? `2px solid ${colors.accent.default}` : `1px solid ${color}`
      }}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
    >
      <span className="canvas-lod-preview__label">{info?.label ?? node.type}</span>
    </div>
  )
}

export const CardLodPreview = memo(CardLodPreviewInner, (prev, next) => prev.node === next.node)
