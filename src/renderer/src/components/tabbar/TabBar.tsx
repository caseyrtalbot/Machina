import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from 'react'
import { ContextMenu, type ContextMenuEntry, type ContextMenuPosition } from '../ContextMenu'

export interface TabBarItem {
  readonly id: string
  readonly label: string
  readonly tooltip?: string
  /** aria-label for the close button (defaults to `Close ${label}`). */
  readonly closeLabel?: string
  /** Shows the dirty dot in the indicator slot. */
  readonly dirty?: boolean
  /** Preview tab: italic title; double-click fires onPin. */
  readonly preview?: boolean
  readonly testId?: string
}

export type TabBarVariant = 'underline' | 'chrome' | 'pill'

export interface TabBarProps {
  readonly variant: TabBarVariant
  readonly items: readonly TabBarItem[]
  readonly activeId: string | null
  readonly ariaLabel: string
  readonly onActivate: (id: string) => void
  /** Presence enables the close affordance: button, middle-click, Delete/Backspace. */
  readonly onClose?: (ids: readonly string[]) => void
  /**
   * Presence enables drag/reorder. Indices are positions in `items`; the
   * consumer decides whether the drop also activates the moved tab.
   */
  readonly onReorder?: (from: number, to: number) => void
  /** Double-click on a preview tab pins it. */
  readonly onPin?: (id: string) => void
  /**
   * Presence enables the right-click menu. `close` routes through the same
   * (possibly animated) close path as the tab's own close button.
   */
  readonly contextMenu?: (
    item: TabBarItem,
    close: (ids: readonly string[]) => void
  ) => readonly ContextMenuEntry[]
  readonly contextMenuUpward?: boolean
  readonly contextMenuTestId?: string
  /** Animate tab enter/exit; exit defers onClose until the animation played. */
  readonly animated?: boolean
  readonly testId?: string
  readonly spacerTestId?: string
  /** Rendered inline after the last tab, inside the scrolling row. */
  readonly trailing?: ReactNode
  /** Rendered pinned to the right edge of the bar. */
  readonly actions?: ReactNode
}

const TAB_EXIT_DURATION_MS = 140

interface TabMenuTarget {
  readonly id: string
  readonly position: ContextMenuPosition
}

export function TabBar({
  variant,
  items,
  activeId,
  ariaLabel,
  onActivate,
  onClose,
  onReorder,
  onPin,
  contextMenu,
  contextMenuUpward,
  contextMenuTestId,
  animated,
  testId,
  spacerTestId,
  trailing,
  actions
}: TabBarProps) {
  const [menu, setMenu] = useState<TabMenuTarget | null>(null)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [exitingIds, setExitingIds] = useState<ReadonlySet<string>>(() => new Set())
  const tabRefs = useRef<Array<HTMLDivElement | null>>([])
  const exitTimers = useRef<number[]>([])

  useEffect(() => {
    return () => {
      for (const t of exitTimers.current) window.clearTimeout(t)
      exitTimers.current = []
    }
  }, [])

  // Close path shared by the close button, middle-click, Delete key, and the
  // context menu. When animated, onClose is deferred until the exit animation
  // has had time to play; the consumer removes the items from `items` then.
  const requestClose = useCallback(
    (ids: readonly string[]) => {
      if (!onClose || ids.length === 0) return
      if (!animated) {
        onClose(ids)
        return
      }
      setExitingIds((prev) => {
        const next = new Set(prev)
        for (const id of ids) next.add(id)
        return next
      })
      const timer = window.setTimeout(() => {
        onClose(ids)
        setExitingIds((prev) => {
          const next = new Set(prev)
          for (const id of ids) next.delete(id)
          return next
        })
        exitTimers.current = exitTimers.current.filter((t) => t !== timer)
      }, TAB_EXIT_DURATION_MS)
      exitTimers.current.push(timer)
    },
    [onClose, animated]
  )

  // Keep the active tab visible when the row overflows horizontally.
  useLayoutEffect(() => {
    const i = items.findIndex((t) => t.id === activeId)
    const el = i >= 0 ? tabRefs.current[i] : null
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }, [activeId, items])

  function activateIndex(i: number) {
    const item = items[i]
    if (!item) return
    onActivate(item.id)
    tabRefs.current[i]?.focus()
  }

  function onTabKeyDown(e: ReactKeyboardEvent<HTMLDivElement>, i: number) {
    if (items.length === 0) return
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      activateIndex((i + 1) % items.length)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      activateIndex((i - 1 + items.length) % items.length)
    } else if (e.key === 'Home') {
      e.preventDefault()
      activateIndex(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      activateIndex(items.length - 1)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const item = items[i]
      if (item) onActivate(item.id)
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && onClose) {
      e.preventDefault()
      const item = items[i]
      if (item) requestClose([item.id])
    }
  }

  // Entries are rebuilt every render so an OPEN menu tracks live state (e.g. a
  // terminal session binding enables its "Move to canvas" item). The menu hides
  // itself if its tab closes while open.
  const menuItem = menu ? items.find((t) => t.id === menu.id) : undefined

  return (
    <div className="te-tabbar" data-variant={variant} data-testid={testId}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        aria-orientation="horizontal"
        className="te-tabbar__list"
      >
        {items.map((item, i) => {
          const isExiting = exitingIds.has(item.id)
          const isActive = item.id === activeId
          const isDropTarget = dropIndex === i && draggingIndex !== null && draggingIndex !== i
          const motionClass = animated ? (isExiting ? ' te-tab-exiting' : ' te-tab-enter') : ''
          return (
            <div
              key={item.id}
              ref={(el) => {
                tabRefs.current[i] = el
              }}
              className={`te-tab${motionClass}`}
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive && !isExiting ? 0 : -1}
              aria-hidden={isExiting || undefined}
              data-active={isActive || undefined}
              data-preview={item.preview || undefined}
              data-dirty={item.dirty || undefined}
              data-dragging={draggingIndex === i || undefined}
              data-drop-target={isDropTarget || undefined}
              data-testid={item.testId}
              draggable={onReorder ? !isExiting : undefined}
              onDragStart={
                onReorder
                  ? (e) => {
                      if (isExiting) return
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', String(i))
                      setDraggingIndex(i)
                    }
                  : undefined
              }
              onDragOver={
                onReorder
                  ? (e) => {
                      if (draggingIndex === null || draggingIndex === i || isExiting) return
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'
                      setDropIndex(i)
                    }
                  : undefined
              }
              onDragLeave={
                onReorder ? () => setDropIndex((cur) => (cur === i ? null : cur)) : undefined
              }
              onDrop={
                onReorder
                  ? (e) => {
                      e.preventDefault()
                      const fromStr = e.dataTransfer.getData('text/plain')
                      const from = fromStr ? Number(fromStr) : draggingIndex
                      setDraggingIndex(null)
                      setDropIndex(null)
                      if (from === null || Number.isNaN(from) || from === i || isExiting) return
                      onReorder(from, i)
                    }
                  : undefined
              }
              onDragEnd={
                onReorder
                  ? () => {
                      setDraggingIndex(null)
                      setDropIndex(null)
                    }
                  : undefined
              }
              onClick={() => {
                if (!isExiting) onActivate(item.id)
              }}
              onDoubleClick={onPin && item.preview ? () => onPin(item.id) : undefined}
              onAuxClick={
                onClose
                  ? (e) => {
                      if (e.button === 1 && !isExiting) {
                        e.preventDefault()
                        requestClose([item.id])
                      }
                    }
                  : undefined
              }
              onMouseDown={(e) => {
                // Suppress middle-click auto-scroll on the tab body.
                if (e.button === 1) e.preventDefault()
              }}
              onKeyDown={(e) => onTabKeyDown(e, i)}
              onContextMenu={
                contextMenu
                  ? (e) => {
                      if (isExiting) return
                      e.preventDefault()
                      setMenu({ id: item.id, position: { x: e.clientX, y: e.clientY } })
                    }
                  : undefined
              }
            >
              <span className="te-tab__title" title={item.tooltip}>
                {item.label}
              </span>
              {onClose && (
                <span className="te-tab__indicator">
                  <span className="te-tab__dirty-dot" aria-hidden="true" />
                  <button
                    type="button"
                    className="te-tab__close"
                    aria-label={item.closeLabel ?? `Close ${item.label}`}
                    tabIndex={-1}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      requestClose([item.id])
                    }}
                  >
                    <svg
                      width={9}
                      height={9}
                      viewBox="0 0 9 9"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    >
                      <line x1="2" y1="2" x2="7" y2="7" />
                      <line x1="7" y1="2" x2="2" y2="7" />
                    </svg>
                  </button>
                </span>
              )}
            </div>
          )
        })}
        {trailing}
      </div>
      <div className="te-tabbar__spacer" data-testid={spacerTestId} aria-hidden="true" />
      {actions ? <div className="te-tabbar__actions">{actions}</div> : null}
      {menu && menuItem && contextMenu && (
        <ContextMenu
          testId={contextMenuTestId}
          position={menu.position}
          openUpward={contextMenuUpward}
          onClose={() => setMenu(null)}
          // False positive: contextMenu only EMBEDS requestClose in onSelect
          // closures; it is never invoked during render.
          // eslint-disable-next-line react-hooks/refs
          items={contextMenu(menuItem, requestClose)}
        />
      )}
    </div>
  )
}
