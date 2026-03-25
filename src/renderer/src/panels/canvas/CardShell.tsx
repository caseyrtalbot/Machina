import { useCallback, useEffect, useRef, useState } from 'react'
import { useCanvasStore } from '../../store/canvas-store'
import { useNodeDrag, useNodeResize } from './use-canvas-drag'
import { colors, canvasTokens, typography } from '../../design/tokens'
import { useEnv } from '../../design/Theme'
import {
  startConnectionDrag,
  endConnectionDrag,
  isConnectionDragActive
} from './ConnectionDragOverlay'
import {
  CARD_TYPE_INFO,
  type CanvasNode,
  type CanvasNodeType,
  type CanvasSide
} from '@shared/canvas-types'

interface CardShellProps {
  readonly node: CanvasNode
  readonly title: string
  readonly filePath?: string
  readonly children: React.ReactNode
  readonly onClose: () => void
  readonly onOpenInEditor?: () => void
  readonly onContextMenu?: (e: React.MouseEvent) => void
  readonly titleExtra?: React.ReactNode
}

/** Valid conversion targets for each card type */
export const VALID_CONVERSIONS: Record<CanvasNodeType, readonly CanvasNodeType[]> = {
  text: ['code', 'markdown', 'terminal'],
  code: ['text', 'markdown', 'terminal'],
  markdown: ['text', 'code', 'terminal'],
  note: ['markdown', 'terminal'],
  image: ['text', 'terminal'],
  terminal: ['text'],
  pdf: ['text', 'terminal'],
  'project-file': ['text'],
  'system-artifact': ['markdown', 'text'],
  'file-view': ['text']
} as const

function ConvertMenu({
  nodeId,
  nodeType,
  onClose
}: {
  readonly nodeId: string
  readonly nodeType: CanvasNodeType
  readonly onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const targets = VALID_CONVERSIONS[nodeType]

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handler)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handler)
    }
  }, [onClose])

  return (
    <div
      ref={menuRef}
      className="absolute flex flex-col py-1"
      style={{
        top: '100%',
        right: 0,
        marginTop: 2,
        minWidth: 120,
        backgroundColor: colors.bg.elevated,
        border: `1px solid ${colors.border.default}`,
        borderRadius: canvasTokens.cardRadius,
        zIndex: 50,
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {targets.map((target) => {
        const info = CARD_TYPE_INFO[target]
        return (
          <button
            key={target}
            className="flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:opacity-80"
            style={{
              color: colors.text.secondary,
              backgroundColor: 'transparent',
              border: 'none',
              cursor: 'pointer'
            }}
            onClick={(e) => {
              e.stopPropagation()
              useCanvasStore.getState().updateNodeType(nodeId, target)
              onClose()
            }}
          >
            <span style={{ color: colors.text.muted, fontFamily: 'monospace', width: 20 }}>
              {info.icon}
            </span>
            {info.label}
          </button>
        )
      })}
    </div>
  )
}

function nearestSide(clientX: number, clientY: number, rect: DOMRect): CanvasSide {
  const relX = (clientX - rect.left) / rect.width - 0.5
  const relY = (clientY - rect.top) / rect.height - 0.5
  if (Math.abs(relX) > Math.abs(relY)) {
    return relX > 0 ? 'right' : 'left'
  }
  return relY > 0 ? 'bottom' : 'top'
}

/** Icon button used in the card title bar. 24x24 hit target, 12x12 icon. */
function TitleBarButton({
  onClick,
  label,
  children
}: {
  readonly onClick: (e: React.MouseEvent) => void
  readonly label: string
  readonly children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center rounded hover:opacity-80"
      style={{
        width: 24,
        height: 24,
        color: colors.text.primary,
        opacity: 0.4,
        cursor: 'pointer',
        padding: '0 2px',
        borderRadius: 4
      }}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  )
}

export function CardShell({
  node,
  title,
  filePath,
  children,
  onClose,
  onOpenInEditor,
  onContextMenu,
  titleExtra
}: CardShellProps) {
  const copyText = filePath ?? title
  const isSelected = useCanvasStore((s) => s.selectedNodeIds.has(node.id))
  const isFocused = useCanvasStore((s) => s.focusedCardId === node.id)
  const isLocked = useCanvasStore((s) => s.lockedCardId === node.id)
  const setSelection = useCanvasStore((s) => s.setSelection)
  const toggleSelection = useCanvasStore((s) => s.toggleSelection)
  const setHoveredNode = useCanvasStore((s) => s.setHoveredNode)
  const setFocusedCard = useCanvasStore((s) => s.setFocusedCard)
  const lockCard = useCanvasStore((s) => s.lockCard)
  const unlockCard = useCanvasStore((s) => s.unlockCard)
  const { cardBlur, cardTitleFontSize } = useEnv()
  const { onDragStart } = useNodeDrag(node.id)
  const { onResizeStart } = useNodeResize(node.id, node.type)
  const [hovered, setHovered] = useState(false)
  const [convertMenuOpen, setConvertMenuOpen] = useState(false)

  const isActive = node.metadata?.isActive === true

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (e.shiftKey) {
        toggleSelection(node.id)
      } else {
        setSelection(new Set([node.id]))
      }
      setFocusedCard(node.id)
    },
    [node.id, setSelection, toggleSelection, setFocusedCard]
  )

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (isLocked) {
        unlockCard()
      } else {
        lockCard(node.id)
      }
    },
    [node.id, isLocked, lockCard, unlockCard]
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isConnectionDragActive()) return
      e.stopPropagation()
      const rect = e.currentTarget.getBoundingClientRect()
      const side = nearestSide(e.clientX, e.clientY, rect)
      endConnectionDrag(node.id, side)
    },
    [node.id]
  )

  return (
    <div
      data-canvas-node
      className={`absolute flex flex-col canvas-card te-card-enter${isFocused ? ' canvas-card--focused' : ''}${isLocked ? ' canvas-card--locked' : ''}`}
      style={{
        left: node.position.x,
        top: node.position.y,
        width: node.size.width,
        height: node.size.height,
        backgroundColor: canvasTokens.card,
        borderRadius: 8,
        border: `1px solid ${colors.border.default}`,
        boxShadow: isLocked
          ? `0 0 0 1px rgba(255, 255, 255, 0.5), 0 2px 8px rgba(0, 0, 0, 0.5)`
          : isFocused
            ? `0 0 0 1px rgba(255, 255, 255, 0.5), 0 2px 8px rgba(0, 0, 0, 0.5)`
            : isSelected
              ? `0 0 0 1px #4a9eff, 0 2px 8px rgba(0, 0, 0, 0.5)`
              : `0 2px 8px rgba(0, 0, 0, 0.5)`,
        overflow: 'hidden',
        contain: 'layout style',
        backdropFilter: `blur(${cardBlur}px) saturate(1.2)`,
        WebkitBackdropFilter: `blur(${cardBlur}px) saturate(1.2)`,
        ...(isActive
          ? ({
              '--activity-color': 'rgba(167, 139, 250, 0.3)',
              animation: 'te-card-glow 2s ease-in-out infinite'
            } as React.CSSProperties)
          : {})
      }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={onContextMenu}
      onPointerUp={handlePointerUp}
      onMouseEnter={() => {
        setHovered(true)
        setHoveredNode(node.id)
      }}
      onMouseLeave={() => {
        setHovered(false)
        setHoveredNode(null)
      }}
    >
      {/* Title bar */}
      <div
        className="flex items-center justify-between shrink-0 select-none"
        style={{
          padding: '7px 10px',
          backgroundColor: canvasTokens.cardTitleBar,
          borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
          borderRadius: '7px 7px 0 0',
          cursor: 'grab'
        }}
        onPointerDown={onDragStart}
      >
        <span className="flex items-center gap-1.5 min-w-0 flex-1">
          {isActive && <span className="te-active-dot shrink-0" />}
          <span
            className="truncate"
            style={{
              fontFamily: typography.fontFamily.mono,
              fontSize: cardTitleFontSize,
              lineHeight: 1,
              fontWeight: 500,
              color: colors.text.primary,
              opacity: 0.8,
              direction: 'rtl',
              textAlign: 'left',
              unicodeBidi: 'plaintext'
            }}
            title={copyText}
          >
            {title}
          </span>
          {titleExtra}
        </span>
        {node.metadata?.scope === 'project' && (
          <span
            className="px-1 py-0.5 rounded shrink-0 ml-2"
            style={{ backgroundColor: '#6366f122', color: '#818cf8', fontSize: 9 }}
          >
            PROJECT
          </span>
        )}
        <div
          className="flex items-center gap-0.5 ml-2 shrink-0 relative"
          style={{
            opacity: hovered || isFocused || isLocked ? 1 : 0,
            transition: 'opacity 150ms ease'
          }}
        >
          <TitleBarButton
            onClick={(e) => {
              e.stopPropagation()
              navigator.clipboard.writeText(copyText)
            }}
            label="Copy path"
          >
            <svg
              width={12}
              height={12}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </TitleBarButton>
          {VALID_CONVERSIONS[node.type].length > 0 && (
            <TitleBarButton
              onClick={(e) => {
                e.stopPropagation()
                setConvertMenuOpen((prev) => !prev)
              }}
              label="Convert card type"
            >
              <svg
                width={12}
                height={12}
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M1 4h8l-2-2M11 8H3l2 2" />
              </svg>
            </TitleBarButton>
          )}
          {onOpenInEditor && (
            <TitleBarButton
              onClick={(e) => {
                e.stopPropagation()
                onOpenInEditor()
              }}
              label="Open in editor"
            >
              <svg
                width={12}
                height={12}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </TitleBarButton>
          )}
          {convertMenuOpen && (
            <ConvertMenu
              nodeId={node.id}
              nodeType={node.type}
              onClose={() => setConvertMenuOpen(false)}
            />
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onClose()
            }}
            className="tile-close-btn flex items-center justify-center rounded"
            style={{
              width: 24,
              height: 24,
              color: colors.text.primary,
              opacity: 0.4,
              cursor: 'pointer',
              padding: '0 2px',
              borderRadius: 4,
              border: 'none',
              background: 'none'
            }}
            aria-label="Close card"
            title="Close card"
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
      </div>

      {/* Content area — hidden scrollbars via .canvas-card-content */}
      <div className="flex-1 canvas-card-content relative" style={{ minHeight: 0 }}>
        {children}
        {/* Pointer-events shield: blocks content interaction until card is focused.
            First click selects+focuses the card, second click interacts with content. */}
        {!isFocused && !isLocked && <div className="absolute inset-0 z-[1]" aria-hidden="true" />}
      </div>

      {/* Resize handle — only visible on hover */}
      {hovered && (
        <div
          className="absolute bottom-0 right-0 cursor-nwse-resize"
          style={{ width: 16, height: 16, zIndex: 5 }}
          onPointerDown={onResizeStart}
        >
          <svg width={16} height={16} viewBox="0 0 16 16" style={{ color: colors.text.muted }}>
            <path d="M14 2L2 14M14 8L8 14" stroke="currentColor" strokeWidth="1" opacity="0.4" />
          </svg>
        </div>
      )}

      {/* Anchor dots for edge creation */}
      {hovered &&
        (['top', 'right', 'bottom', 'left'] as CanvasSide[]).map((side) => {
          const style: React.CSSProperties = {
            position: 'absolute',
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: 'rgb(72, 210, 130)',
            cursor: 'crosshair',
            zIndex: 10,
            transition: 'opacity 200ms ease',
            ...(side === 'top' && { top: -4, left: '50%', marginLeft: -4 }),
            ...(side === 'bottom' && { bottom: -4, left: '50%', marginLeft: -4 }),
            ...(side === 'left' && { left: -4, top: '50%', marginTop: -4 }),
            ...(side === 'right' && { right: -4, top: '50%', marginTop: -4 })
          }
          return (
            <div
              key={side}
              style={style}
              onPointerDown={(e) => {
                e.stopPropagation()
                startConnectionDrag(node.id, side, e.clientX, e.clientY, e.nativeEvent)
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
