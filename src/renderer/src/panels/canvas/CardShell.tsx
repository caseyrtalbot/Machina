import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCanvas, useCanvasApi, useCanvasId } from './canvas-store-context'
import { useVaultStore } from '../../store/vault-store'
import { useNodeDrag, useNodeResize } from './use-canvas-drag'
import {
  borderRadius,
  colors,
  canvasTokens,
  floatingPanel,
  transitions,
  typography
} from '../../design/tokens'
import { useEnv } from '../../design/Theme'
import {
  startConnectionDrag,
  endConnectionDrag,
  isConnectionDragActive
} from './ConnectionDragOverlay'
import { convertNodeTypeCommand, getCommandStack, removeNodeViaCallback } from './canvas-commands'
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
  readonly onActivateContentClick?: (e: React.MouseEvent<HTMLDivElement>) => void
  readonly titleExtra?: React.ReactNode
  readonly headerActions?: React.ReactNode
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
  'file-view': ['text'],
  'project-folder': [],
  'terminal-block': []
} as const

function ConvertMenu({
  nodeId,
  nodeType,
  anchorRect,
  onClose
}: {
  readonly nodeId: string
  readonly nodeType: CanvasNodeType
  readonly anchorRect: DOMRect
  readonly onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const canvas = useCanvasApi()
  const canvasId = useCanvasId()
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

  // Anchor rect is captured on open; close on scroll/resize rather than re-measuring.
  useEffect(() => {
    window.addEventListener('scroll', onClose, true)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('scroll', onClose, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={menuRef}
      className="fixed flex flex-col py-1"
      style={{
        top: anchorRect.bottom + 2,
        right: window.innerWidth - anchorRect.right,
        minWidth: 120,
        backgroundColor: colors.bg.elevated,
        border: `1px solid ${colors.border.default}`,
        borderRadius: canvasTokens.cardRadius,
        zIndex: 50,
        boxShadow: floatingPanel.shadowCompact
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
              const cmd = convertNodeTypeCommand(canvas, nodeId, target)
              if (cmd) {
                const stack = getCommandStack(canvasId)
                if (stack) stack.execute(cmd)
                else void cmd.execute()
              }
              onClose()
            }}
          >
            <span
              style={{
                color: colors.text.muted,
                fontFamily: typography.fontFamily.mono,
                width: 20
              }}
            >
              {info.icon}
            </span>
            {info.label}
          </button>
        )
      })}
    </div>,
    document.body
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
  children,
  ref
}: {
  readonly onClick: (e: React.MouseEvent) => void
  readonly label: string
  readonly children: React.ReactNode
  readonly ref?: React.Ref<HTMLButtonElement>
}) {
  return (
    <button
      ref={ref}
      onClick={onClick}
      className="canvas-card__action-btn flex items-center justify-center hover:opacity-80"
      style={{
        width: 24,
        height: 24,
        color: colors.text.primary,
        opacity: 0.4,
        cursor: 'pointer',
        padding: '0 2px',
        borderRadius: borderRadius.tool
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
  onActivateContentClick,
  titleExtra,
  headerActions
}: CardShellProps) {
  const copyText = filePath ?? title
  const canvas = useCanvasApi()
  const canvasId = useCanvasId()
  const isSelected = useCanvas((s) => s.selectedNodeIds.has(node.id))
  const isFocused = useCanvas((s) => s.focusedCardId === node.id)
  const isLocked = useCanvas((s) => s.lockedCardId === node.id)
  const isPinPulsing = useCanvas((s) => s.recentlyPinnedNodeIds.has(node.id))
  const isInteracting = useCanvas((s) => s.isInteracting)
  const setSelection = useCanvas((s) => s.setSelection)
  const toggleSelection = useCanvas((s) => s.toggleSelection)
  const setHoveredNode = useCanvas((s) => s.setHoveredNode)
  const setFocusedCard = useCanvas((s) => s.setFocusedCard)
  const lockCard = useCanvas((s) => s.lockCard)
  const unlockCard = useCanvas((s) => s.unlockCard)
  const { cardBlur, cardTitleFontSize } = useEnv()
  const { onDragStart } = useNodeDrag(node.id)
  const { onResizeStart } = useNodeResize(node.id, node.type)
  const [hovered, setHovered] = useState(false)
  const [convertAnchor, setConvertAnchor] = useState<DOMRect | null>(null)
  const convertButtonRef = useRef<HTMLButtonElement>(null)

  const isActive = node.metadata?.isActive === true
  const isTerminalCard = node.type === 'terminal'

  // Edge count for note cards
  const edgeCount = useVaultStore((s) => {
    if (node.type !== 'note') return 0
    const fp = filePath ?? node.content
    const artifactId = fp ? s.fileToId[fp] : undefined
    if (!artifactId) return 0
    return s.edgeCountByArtifactId[artifactId] ?? 0
  })

  // Origin accent for non-human artifacts
  const origin = useVaultStore((s) => {
    if (!filePath) return undefined
    const artifactId = s.fileToId[filePath]
    if (!artifactId) return undefined
    return s.artifactById[artifactId]?.origin
  })

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation()
      const target = e.target as HTMLElement
      const clickedContent =
        isTerminalCard &&
        !isFocused &&
        !isLocked &&
        e.button === 0 &&
        !e.shiftKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        Boolean(target.closest('[data-canvas-card-content]'))

      if (e.shiftKey) {
        toggleSelection(node.id)
      } else {
        setSelection(new Set([node.id]))
      }
      setFocusedCard(node.id)
      if (clickedContent) {
        onActivateContentClick?.(e)
      }
    },
    [
      isFocused,
      isLocked,
      isTerminalCard,
      node.id,
      onActivateContentClick,
      setSelection,
      toggleSelection,
      setFocusedCard
    ]
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

  // Route close through the command stack so ⌘Z restores the card (and its
  // edges). The card's own onClose still runs — terminal cards kill their PTY.
  const handleClose = useCallback(() => {
    const stack = getCommandStack(canvasId)
    const cmd = stack ? removeNodeViaCallback(canvas, node.id, onClose) : null
    if (stack && cmd) stack.execute(cmd)
    else onClose()
  }, [node.id, onClose, canvas, canvasId])

  return (
    <div
      data-canvas-node
      className={`absolute flex flex-col canvas-card te-card-enter${isFocused ? ' canvas-card--focused' : ''}${isLocked ? ' canvas-card--locked' : ''}${isPinPulsing ? ' te-pin-pulse' : ''}`}
      style={{
        left: node.position.x,
        top: node.position.y,
        width: node.size.width,
        height: node.size.height,
        background: isTerminalCard
          ? '#050607'
          : `linear-gradient(180deg, color-mix(in srgb, var(--canvas-card-bg) 96%, white 4%), var(--canvas-card-bg))`,
        borderRadius: borderRadius.tool,
        border:
          isFocused || isLocked
            ? '1px solid color-mix(in srgb, var(--color-accent-default) 38%, var(--canvas-card-border))'
            : `1px solid ${canvasTokens.cardBorder}`,
        boxShadow: isLocked
          ? `0 0 0 1px color-mix(in srgb, var(--color-accent-default) 32%, transparent), 0 1px 0 rgba(255,255,255,0.04) inset, ${floatingPanel.shadowCard}`
          : isFocused
            ? `0 0 0 1px color-mix(in srgb, var(--color-accent-default) 26%, transparent), 0 1px 0 rgba(255,255,255,0.04) inset, ${floatingPanel.shadowCard}`
            : isSelected
              ? `0 0 0 1px color-mix(in srgb, var(--color-accent-default) 42%, transparent), 0 1px 0 rgba(255,255,255,0.04) inset, ${floatingPanel.shadowCard}`
              : `0 1px 0 rgba(255,255,255,0.03) inset, ${floatingPanel.shadowCard}`,
        overflow: 'hidden',
        contain: isTerminalCard ? undefined : 'layout style',
        backdropFilter:
          isTerminalCard || isInteracting ? undefined : `blur(${cardBlur}px) saturate(1.4)`,
        WebkitBackdropFilter:
          isTerminalCard || isInteracting ? undefined : `blur(${cardBlur}px) saturate(1.4)`,
        ...(isActive
          ? {
              boxShadow: `0 0 0 1px var(--color-accent-line), ${floatingPanel.shadowCard}`
            }
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
      {/* Title bar — Console card header band: lighter than body, hairline border. */}
      <div
        className="canvas-card__titlebar flex items-center justify-between shrink-0 select-none"
        style={{
          padding: '8px 12px',
          background: isTerminalCard
            ? 'linear-gradient(180deg, rgba(3, 3, 5, 0.96), rgba(3, 3, 5, 0.9))'
            : `color-mix(in srgb, var(--canvas-card-bg) 70%, var(--color-bg-elevated))`,
          borderBottom: `1px solid ${canvasTokens.cardBorder}`,
          borderRadius: 0,
          cursor: 'grab'
        }}
        onPointerDown={onDragStart}
      >
        <span className="flex items-center gap-1.5 min-w-0 flex-1">
          {isActive && <span className="te-active-dot shrink-0" />}
          <span
            className="canvas-card__title truncate"
            style={{
              fontFamily: typography.fontFamily.mono,
              fontSize: cardTitleFontSize - 0.25,
              lineHeight: 1,
              fontWeight: 500,
              color: colors.text.secondary,
              opacity: 0.94,
              direction: 'rtl',
              textAlign: 'left',
              unicodeBidi: 'plaintext'
            }}
            title={copyText}
          >
            {title}
          </span>
          {titleExtra}
          {edgeCount > 0 && (
            <span
              style={{
                fontFamily: typography.fontFamily.mono,
                fontSize: 10,
                color: colors.text.muted,
                opacity: 0.7,
                flexShrink: 0
              }}
            >
              {edgeCount}
            </span>
          )}
        </span>
        {node.metadata?.scope === 'project' && (
          <span
            className="canvas-card__badge shrink-0 ml-2"
            style={{
              color: 'var(--color-accent-default)',
              fontSize: 9,
              fontFamily: typography.fontFamily.mono,
              letterSpacing: '0.14em',
              padding: '1px 6px',
              borderRadius: borderRadius.inline,
              border: '1px solid color-mix(in srgb, var(--color-accent-default) 32%, transparent)',
              background: 'color-mix(in srgb, var(--color-accent-default) 10%, transparent)'
            }}
          >
            PROJECT
          </span>
        )}
        <div
          className="canvas-card__actions flex items-center gap-0.5 ml-2 shrink-0 relative"
          style={{
            opacity: hovered || isFocused || isLocked ? 1 : undefined
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
              ref={convertButtonRef}
              onClick={(e) => {
                e.stopPropagation()
                setConvertAnchor((prev) =>
                  prev ? null : (convertButtonRef.current?.getBoundingClientRect() ?? null)
                )
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
          {convertAnchor && (
            <ConvertMenu
              nodeId={node.id}
              nodeType={node.type}
              anchorRect={convertAnchor}
              onClose={() => setConvertAnchor(null)}
            />
          )}
          {headerActions}
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleClose()
            }}
            className="canvas-card__action-btn tile-close-btn flex items-center justify-center"
            style={{
              width: 24,
              height: 24,
              color: colors.text.primary,
              opacity: 0.4,
              cursor: 'pointer',
              padding: '0 2px',
              borderRadius: borderRadius.tool,
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
      <div
        data-canvas-card-content
        className={`flex-1 relative${isTerminalCard ? '' : ' canvas-card-content'}`}
        style={{
          minHeight: 0,
          overflow: isTerminalCard ? 'hidden' : undefined,
          contain: isTerminalCard ? undefined : 'layout style paint'
        }}
      >
        {children}
        {/* Pointer-events shield: blocks content interaction until card is focused.
            First click selects+focuses the card, second click interacts with content. */}
        {!isFocused && !isLocked && <div className="absolute inset-0 z-[1]" aria-hidden="true" />}
      </div>

      {/* Origin accent — subtle left border for non-human artifacts */}
      {origin && origin !== 'human' && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 2,
            borderRadius: 0,
            backgroundColor:
              origin === 'source'
                ? 'color-mix(in srgb, var(--signal-info) 50%, transparent)'
                : 'color-mix(in srgb, var(--signal-success) 40%, transparent)',
            pointerEvents: 'none',
            zIndex: 6
          }}
        />
      )}

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
            borderRadius: 0,
            backgroundColor: 'color-mix(in srgb, var(--color-accent-default) 74%, white 26%)',
            boxShadow: '0 0 0 1px color-mix(in srgb, var(--color-accent-default) 18%, transparent)',
            cursor: 'crosshair',
            zIndex: 10,
            transition: `opacity ${transitions.slow}`,
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
                startConnectionDrag(
                  canvas,
                  canvasId,
                  node.id,
                  side,
                  e.clientX,
                  e.clientY,
                  e.nativeEvent
                )
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
