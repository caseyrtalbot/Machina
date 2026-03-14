import { useCallback, useState } from 'react'
import { useCanvasStore } from '../../store/canvas-store'
import { useNodeDrag, useNodeResize } from './use-canvas-drag'
import { colors, borderRadius } from '../../design/tokens'
import { startConnectionDrag, endConnectionDrag } from './ConnectionDragOverlay'
import type { CanvasNode, CanvasSide } from '@shared/canvas-types'

interface CardShellProps {
  node: CanvasNode
  title: string
  children: React.ReactNode
  onClose: () => void
}

export function CardShell({ node, title, children, onClose }: CardShellProps) {
  const isSelected = useCanvasStore((s) => s.selectedNodeIds.has(node.id))
  const setSelection = useCanvasStore((s) => s.setSelection)
  const toggleSelection = useCanvasStore((s) => s.toggleSelection)
  const { onDragStart } = useNodeDrag(node.id)
  const { onResizeStart } = useNodeResize(node.id, node.type)
  const [hovered, setHovered] = useState(false)

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

  return (
    <div
      data-canvas-node
      className="absolute flex flex-col overflow-hidden"
      style={{
        left: node.position.x,
        top: node.position.y,
        width: node.size.width,
        height: node.size.height,
        backgroundColor: colors.bg.surface,
        borderRadius: borderRadius.card,
        border: `1px solid ${isSelected ? colors.accent.default : colors.border.default}`,
        boxShadow: isSelected ? `0 0 0 1px ${colors.accent.default}` : 'none'
      }}
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Header / drag handle */}
      <div
        className="flex items-center justify-between px-3 py-1.5 shrink-0 select-none"
        style={{
          borderBottom: `1px solid ${colors.border.subtle}`,
          cursor: 'grab'
        }}
        onPointerDown={onDragStart}
      >
        <span className="text-xs font-medium truncate" style={{ color: colors.text.secondary }}>
          {title}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          className="ml-2 shrink-0 flex items-center justify-center rounded"
          style={{ width: 18, height: 18, color: colors.text.muted }}
          aria-label="Close card"
        >
          <svg
            width={12}
            height={12}
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M3 3l6 6M9 3l-6 6" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">{children}</div>

      {/* Resize handle */}
      <div
        className="absolute bottom-0 right-0 cursor-nwse-resize"
        style={{ width: 12, height: 12 }}
        onPointerDown={onResizeStart}
      >
        <svg width={12} height={12} viewBox="0 0 12 12" style={{ color: colors.text.muted }}>
          <path d="M10 2L2 10M10 6L6 10" stroke="currentColor" strokeWidth="1" opacity="0.5" />
        </svg>
      </div>

      {/* Anchor dots for edge creation */}
      {hovered &&
        (['top', 'right', 'bottom', 'left'] as CanvasSide[]).map((side) => {
          const style: React.CSSProperties = {
            position: 'absolute',
            width: 10,
            height: 10,
            borderRadius: '50%',
            backgroundColor: colors.accent.default,
            cursor: 'crosshair',
            zIndex: 10,
            ...(side === 'top' && { top: -5, left: '50%', marginLeft: -5 }),
            ...(side === 'bottom' && { bottom: -5, left: '50%', marginLeft: -5 }),
            ...(side === 'left' && { left: -5, top: '50%', marginTop: -5 }),
            ...(side === 'right' && { right: -5, top: '50%', marginTop: -5 })
          }
          return (
            <div
              key={side}
              style={style}
              onPointerDown={(e) => {
                e.stopPropagation()
                startConnectionDrag(node.id, side)
              }}
              onPointerUp={(e) => {
                e.stopPropagation()
                endConnectionDrag(node.id, side)
              }}
            />
          )
        })}
    </div>
  )
}
