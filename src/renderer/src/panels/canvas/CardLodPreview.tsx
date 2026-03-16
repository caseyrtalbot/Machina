import { useCallback } from 'react'
import { useCanvasStore } from '../../store/canvas-store'
import { colors, borderRadius } from '../../design/tokens'
import { CARD_TYPE_INFO, type CanvasNode } from '@shared/canvas-types'
import type { LodLevel } from './use-canvas-lod'

interface CardLodPreviewProps {
  node: CanvasNode
  lod: LodLevel
}

/** Type-based colors for LOD rectangles */
const LOD_COLORS: Record<string, string> = {
  text: '#94a3b8',
  code: '#22d3ee',
  markdown: '#a78bfa',
  note: '#38bdf8',
  image: '#f472b6',
  terminal: '#34d399'
}

/**
 * Lightweight LOD renderer for zoomed-out views.
 * - preview: colored rectangle with type label
 * - dot: small colored circle
 */
export function CardLodPreview({ node, lod }: CardLodPreviewProps) {
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

  const color = LOD_COLORS[node.type] ?? '#94a3b8'

  if (lod === 'dot') {
    return (
      <div
        data-canvas-node
        className="absolute rounded-full"
        style={{
          left: node.position.x + node.size.width / 2 - 4,
          top: node.position.y + node.size.height / 2 - 4,
          width: 8,
          height: 8,
          backgroundColor: color,
          border: isSelected ? `2px solid ${colors.accent.default}` : 'none',
          opacity: 0.8
        }}
        onClick={handleClick}
      />
    )
  }

  // preview mode
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
