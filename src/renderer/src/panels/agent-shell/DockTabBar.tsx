import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import { useThreadStore } from '../../store/thread-store'
import { DOCK_TAB_KINDS, type DockTab, type DockTabKind } from '@shared/dock-types'
import { borderRadius, colors, spacing, typography, zIndex } from '../../design/tokens'
import { ContextMenu, type ContextMenuPosition } from '../../components/ContextMenu'

const EMPTY_TABS: readonly DockTab[] = []

interface TabMenuTarget {
  readonly index: number
  readonly position: ContextMenuPosition
}

function basenameOf(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const slash = trimmed.lastIndexOf('/')
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed
}

function tabLabel(tab: DockTab): string {
  switch (tab.kind) {
    case 'editor':
      return tab.path ? basenameOf(tab.path) : 'untitled'
    case 'canvas':
      return tab.id === 'default' ? 'canvas' : tab.id
    case 'terminal':
      return tab.sessionId ? `terminal · ${tab.sessionId.slice(0, 6)}` : 'terminal'
    default:
      return tab.kind
  }
}

function tabTooltip(tab: DockTab): string | undefined {
  if (tab.kind === 'editor' && tab.path) return tab.path
  if (tab.kind === 'canvas' && tab.id !== 'default') return `canvas · ${tab.id}`
  if (tab.kind === 'terminal' && tab.sessionId) return `terminal · ${tab.sessionId}`
  return undefined
}

export function DockTabBar({
  activeIndex,
  onActivate
}: {
  readonly activeIndex: number
  readonly onActivate: (i: number) => void
}) {
  const id = useThreadStore((s) => s.activeThreadId)
  const tabs = useThreadStore((s) => (id ? (s.dockTabsByThreadId[id] ?? EMPTY_TABS) : EMPTY_TABS))
  const remove = useThreadStore((s) => s.removeDockTab)
  const removeMany = useThreadStore((s) => s.removeDockTabs)
  const add = useThreadStore((s) => s.openOrFocusDockTab)
  const reorder = useThreadStore((s) => s.reorderDockTab)
  const [adderOpen, setAdderOpen] = useState(false)
  const [menu, setMenu] = useState<TabMenuTarget | null>(null)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [hoveredAdderItem, setHoveredAdderItem] = useState<DockTabKind | null>(null)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const adderRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Array<HTMLDivElement | null>>([])

  useEffect(() => {
    if (!adderOpen) return
    function onMouseDown(e: MouseEvent) {
      if (adderRef.current && !adderRef.current.contains(e.target as Node)) {
        setAdderOpen(false)
      }
    }
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') setAdderOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [adderOpen])

  // Keep the active tab visible when the strip overflows horizontally.
  useLayoutEffect(() => {
    const el = tabRefs.current[activeIndex]
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }, [activeIndex, tabs.length])

  function focusTab(i: number) {
    tabRefs.current[i]?.focus()
  }

  function onTabKeyDown(e: ReactKeyboardEvent<HTMLDivElement>, i: number) {
    if (tabs.length === 0) return
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      const next = (i + 1) % tabs.length
      onActivate(next)
      focusTab(next)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      const next = (i - 1 + tabs.length) % tabs.length
      onActivate(next)
      focusTab(next)
    } else if (e.key === 'Home') {
      e.preventDefault()
      onActivate(0)
      focusTab(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      const last = tabs.length - 1
      onActivate(last)
      focusTab(last)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onActivate(i)
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      remove(i)
    }
  }

  function newTab(kind: DockTabKind) {
    setAdderOpen(false)
    let tab: DockTab
    switch (kind) {
      case 'canvas':
        tab = { kind: 'canvas', id: 'default' }
        break
      case 'editor':
        tab = { kind: 'editor', path: '' }
        break
      case 'terminal':
        tab = { kind: 'terminal', sessionId: '' }
        break
      default:
        tab = { kind }
        break
    }
    // openOrFocusDockTab handles both add-and-activate and focus-existing,
    // so we don't manually call onActivate here.
    add(tab)
  }

  function closeTab(index: number) {
    remove(index)
  }

  function closeOthers(keep: number) {
    const indices: number[] = []
    for (let i = 0; i < tabs.length; i += 1) if (i !== keep) indices.push(i)
    removeMany(indices)
  }

  function closeToRight(from: number) {
    const indices: number[] = []
    for (let i = from + 1; i < tabs.length; i += 1) indices.push(i)
    removeMany(indices)
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        height: spacing.dockTabBarHeight,
        flexShrink: 0,
        borderBottom: `1px solid ${colors.tab.border}`
      }}
    >
      <div
        role="tablist"
        aria-label="Dock tabs"
        aria-orientation="horizontal"
        style={{
          display: 'flex',
          alignItems: 'stretch',
          flex: 1,
          minWidth: 0,
          overflowX: 'auto',
          overflowY: 'hidden',
          scrollbarWidth: 'thin'
        }}
      >
        {tabs.map((t, i) => {
          const isActive = i === activeIndex
          const isHovered = hoveredIndex === i
          const isDragging = draggingIndex === i
          const isDropTarget = dropIndex === i && draggingIndex !== null && draggingIndex !== i
          return (
            <div
              key={i}
              ref={(el) => {
                tabRefs.current[i] = el
              }}
              role="tab"
              id={`dock-tab-${i}`}
              aria-selected={isActive}
              aria-controls={`dock-tab-panel-${i}`}
              tabIndex={isActive ? 0 : -1}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', String(i))
                setDraggingIndex(i)
              }}
              onDragOver={(e) => {
                if (draggingIndex === null || draggingIndex === i) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setDropIndex(i)
              }}
              onDragLeave={() => {
                setDropIndex((cur) => (cur === i ? null : cur))
              }}
              onDrop={(e) => {
                e.preventDefault()
                const fromStr = e.dataTransfer.getData('text/plain')
                const from = fromStr ? Number(fromStr) : draggingIndex
                setDraggingIndex(null)
                setDropIndex(null)
                if (from === null || Number.isNaN(from) || from === i) return
                reorder(from, i)
                onActivate(i)
              }}
              onDragEnd={() => {
                setDraggingIndex(null)
                setDropIndex(null)
              }}
              onClick={() => onActivate(i)}
              onKeyDown={(e) => onTabKeyDown(e, i)}
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex((cur) => (cur === i ? null : cur))}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ index: i, position: { x: e.clientX, y: e.clientY } })
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '0 12px',
                height: '100%',
                flexShrink: 0,
                background: isHovered && !isActive ? colors.tab.bgHover : 'transparent',
                borderLeft: isDropTarget
                  ? `2px solid ${colors.accent.default}`
                  : '2px solid transparent',
                borderBottom: isActive
                  ? `1.5px solid ${colors.accent.default}`
                  : `1px solid transparent`,
                color: isActive ? colors.tab.fgActive : colors.tab.fg,
                fontFamily: typography.fontFamily.mono,
                fontSize: typography.metadata.size,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                outline: 'none',
                opacity: isDragging ? 0.5 : 1,
                transition:
                  'background 100ms ease-out, color 100ms ease-out, opacity 100ms ease-out'
              }}
            >
              <span
                title={tabTooltip(t)}
                style={{
                  maxWidth: 180,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {tabLabel(t)}
              </span>
              <button
                type="button"
                aria-label={`close ${t.kind} tab`}
                tabIndex={-1}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  remove(i)
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 14,
                  height: 14,
                  padding: 0,
                  border: 'none',
                  background: 'transparent',
                  borderRadius: borderRadius.inline,
                  fontSize: 11,
                  lineHeight: 1,
                  color: colors.text.muted,
                  cursor: 'pointer',
                  opacity: isActive || isHovered ? 1 : 0,
                  transition: 'opacity 100ms ease-out',
                  pointerEvents: isActive || isHovered ? 'auto' : 'none'
                }}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>
      <div
        ref={adderRef}
        style={{ position: 'relative', display: 'inline-flex', alignItems: 'stretch' }}
      >
        <button
          aria-label="Add tab"
          title="Add tab"
          aria-haspopup="menu"
          aria-expanded={adderOpen}
          onClick={() => setAdderOpen((v) => !v)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: spacing.dockTabBarHeight,
            height: '100%',
            flexShrink: 0,
            background: 'transparent',
            border: 'none',
            color: colors.text.muted,
            fontSize: 14,
            lineHeight: 1,
            cursor: 'pointer'
          }}
        >
          +
        </button>
        {adderOpen && (
          <div
            role="menu"
            className="sidebar-popover"
            style={{
              position: 'absolute',
              top: spacing.dockTabBarHeight + 4,
              right: 0,
              minWidth: 140,
              padding: 4,
              zIndex: zIndex.dockPopover
            }}
          >
            {DOCK_TAB_KINDS.map((k) => {
              const isHovered = hoveredAdderItem === k
              return (
                <div
                  key={k}
                  role="menuitem"
                  onClick={() => newTab(k)}
                  onMouseEnter={() => setHoveredAdderItem(k)}
                  onMouseLeave={() => setHoveredAdderItem((cur) => (cur === k ? null : cur))}
                  style={{
                    padding: '6px 10px',
                    fontFamily: typography.fontFamily.mono,
                    fontSize: typography.metadata.size,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: isHovered ? colors.text.primary : colors.text.secondary,
                    background: isHovered
                      ? 'color-mix(in srgb, var(--color-text-primary) 5%, transparent)'
                      : 'transparent',
                    borderRadius: borderRadius.inline,
                    cursor: 'pointer'
                  }}
                >
                  {k}
                </div>
              )
            })}
          </div>
        )}
      </div>
      {menu && (
        <ContextMenu
          position={menu.position}
          onClose={() => setMenu(null)}
          items={[
            {
              id: 'close',
              label: 'Close tab',
              onSelect: () => closeTab(menu.index)
            },
            {
              id: 'close-others',
              label: 'Close other tabs',
              disabled: tabs.length <= 1,
              onSelect: () => closeOthers(menu.index)
            },
            {
              id: 'close-right',
              label: 'Close tabs to the right',
              disabled: menu.index >= tabs.length - 1,
              onSelect: () => closeToRight(menu.index)
            }
          ]}
        />
      )}
    </div>
  )
}
