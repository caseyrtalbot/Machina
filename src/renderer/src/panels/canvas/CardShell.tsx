import { useCallback, useEffect, useRef, useState } from 'react'
import { ContextMenu, type ContextMenuEntry } from '../../components/ContextMenu'
import { useCanvas, useCanvasApi, useCanvasId } from './canvas-store-context'
import { useVaultStore } from '../../store/vault-store'
import { useNodeDrag, useNodeResize } from './use-canvas-drag'
import { CARD_BLUR_PX } from '../../design/themes'
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
      className="canvas-card__action-btn"
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
  const cardBlur = CARD_BLUR_PX
  const { onDragStart } = useNodeDrag(node.id)
  const { onResizeStart } = useNodeResize(node.id, node.type)
  const [convertAnchor, setConvertAnchor] = useState<DOMRect | null>(null)
  const convertButtonRef = useRef<HTMLButtonElement>(null)

  // Anchor rect is captured on open; close on scroll/resize rather than re-measuring.
  useEffect(() => {
    if (!convertAnchor) return
    const close = () => setConvertAnchor(null)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [convertAnchor])

  const convertEntries: readonly ContextMenuEntry[] = VALID_CONVERSIONS[node.type].map(
    (target) => ({
      id: target,
      label: CARD_TYPE_INFO[target].label,
      onSelect: () => {
        const cmd = convertNodeTypeCommand(canvas, node.id, target)
        if (cmd) {
          const stack = getCommandStack(canvasId)
          if (stack) stack.execute(cmd)
          else void cmd.execute()
        }
      }
    })
  )

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
      data-terminal={isTerminalCard ? '' : undefined}
      data-selected={isSelected ? '' : undefined}
      data-active={isActive ? '' : undefined}
      className={`canvas-card te-card-enter${isFocused ? ' canvas-card--focused' : ''}${isLocked ? ' canvas-card--locked' : ''}${isPinPulsing ? ' te-pin-pulse' : ''}`}
      style={{
        left: node.position.x,
        top: node.position.y,
        width: node.size.width,
        height: node.size.height,
        backdropFilter:
          isTerminalCard || isInteracting ? undefined : `blur(${cardBlur}px) saturate(1.4)`,
        WebkitBackdropFilter:
          isTerminalCard || isInteracting ? undefined : `blur(${cardBlur}px) saturate(1.4)`
      }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={onContextMenu}
      onPointerUp={handlePointerUp}
      onMouseEnter={() => setHoveredNode(node.id)}
      onMouseLeave={() => setHoveredNode(null)}
    >
      {/* Title bar — Console card header band: lighter than body, hairline border. */}
      <div className="canvas-card__titlebar" onPointerDown={onDragStart}>
        <span className="canvas-card__title-group">
          {isActive && <span className="te-active-dot" />}
          <span className="canvas-card__title" title={copyText}>
            {title}
          </span>
          {titleExtra}
          {edgeCount > 0 && <span className="canvas-card__edge-count">{edgeCount}</span>}
        </span>
        {node.metadata?.scope === 'project' && (
          <span className="canvas-card__badge canvas-card__badge--project">PROJECT</span>
        )}
        <div className="canvas-card__actions">
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
            <ContextMenu
              position={{ x: convertAnchor.right, y: convertAnchor.bottom + 2 }}
              alignRight
              items={convertEntries}
              onClose={() => setConvertAnchor(null)}
              minWidth={120}
            />
          )}
          {headerActions}
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleClose()
            }}
            className="canvas-card__action-btn tile-close-btn"
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
        className={`canvas-card__content${isTerminalCard ? '' : ' canvas-card-content'}`}
      >
        {children}
        {/* Pointer-events shield: blocks content interaction until card is focused.
            First click selects+focuses the card, second click interacts with content. */}
        {!isFocused && !isLocked && <div className="canvas-card__shield" aria-hidden="true" />}
      </div>

      {/* Origin accent — subtle left border for non-human artifacts. Color varies
          by origin at runtime, so backgroundColor stays inline. */}
      {origin && origin !== 'human' && (
        <div
          aria-hidden="true"
          className="canvas-card__origin-accent"
          style={{
            backgroundColor:
              origin === 'source'
                ? 'color-mix(in srgb, var(--signal-info) 50%, transparent)'
                : 'color-mix(in srgb, var(--signal-success) 40%, transparent)'
          }}
        />
      )}

      {/* Resize handle — revealed on card hover via .canvas-card__resize */}
      <div className="canvas-card__resize" onPointerDown={onResizeStart}>
        <svg width={16} height={16} viewBox="0 0 16 16" className="canvas-card__resize-icon">
          <path d="M14 2L2 14M14 8L8 14" stroke="currentColor" strokeWidth="1" opacity="0.4" />
        </svg>
      </div>

      {/* Anchor dots for edge creation — revealed on card hover. */}
      {(['top', 'right', 'bottom', 'left'] as CanvasSide[]).map((side) => {
        return (
          <div
            key={side}
            className="canvas-card__anchor"
            data-side={side}
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
