import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import { useThreadStore } from '../../store/thread-store'
import { type DockTab } from '@shared/dock-types'
import { borderRadius, colors, spacing, transitions, typography } from '../../design/tokens'
import { ContextMenu, type ContextMenuPosition } from '../../components/ContextMenu'

const EMPTY_TABS: readonly DockTab[] = []
const TAB_EXIT_DURATION_MS = 140

// Module-scoped stable identity per DockTab object (same pattern as SurfaceDock).
// WeakMap entries get GC'd when the tab leaves the store, so this never grows.
const tabIdMap = new WeakMap<DockTab, string>()
let tabIdCounter = 0
function tabIdentity(tab: DockTab): string {
  const cached = tabIdMap.get(tab)
  if (cached) return cached
  tabIdCounter += 1
  const id = `dt${tabIdCounter}`
  tabIdMap.set(tab, id)
  return id
}

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
  const reorder = useThreadStore((s) => s.reorderDockTab)
  const [menu, setMenu] = useState<TabMenuTarget | null>(null)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
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

  // Animate close: mark target tabs as exiting, then dispatch the actual store
  // removal once the exit animation has had time to play. Indices are recomputed
  // at removal time because the store may shift between click and timeout.
  const animateClose = useCallback(
    (indices: readonly number[]) => {
      if (indices.length === 0) return
      const ids: string[] = []
      for (const i of indices) {
        const tab = tabs[i]
        if (tab) ids.push(tabIdentity(tab))
      }
      if (ids.length === 0) return
      setExitingIds((prev) => {
        const next = new Set(prev)
        for (const tabId of ids) next.add(tabId)
        return next
      })
      const timer = window.setTimeout(() => {
        const cur = useThreadStore.getState()
        const threadId = cur.activeThreadId
        const list = threadId ? (cur.dockTabsByThreadId[threadId] ?? []) : []
        const targetIndices: number[] = []
        for (let i = 0; i < list.length; i += 1) {
          if (ids.includes(tabIdentity(list[i]))) targetIndices.push(i)
        }
        if (targetIndices.length === 1) cur.removeDockTab(targetIndices[0])
        else if (targetIndices.length > 1) cur.removeDockTabs(targetIndices)
        setExitingIds((prev) => {
          const next = new Set(prev)
          for (const tabId of ids) next.delete(tabId)
          return next
        })
        exitTimers.current = exitTimers.current.filter((t) => t !== timer)
      }, TAB_EXIT_DURATION_MS)
      exitTimers.current.push(timer)
    },
    [tabs]
  )

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
      animateClose([i])
    }
  }

  function closeTab(index: number) {
    animateClose([index])
  }

  function closeOthers(keep: number) {
    const indices: number[] = []
    for (let i = 0; i < tabs.length; i += 1) if (i !== keep) indices.push(i)
    animateClose(indices)
  }

  function closeToRight(from: number) {
    const indices: number[] = []
    for (let i = from + 1; i < tabs.length; i += 1) indices.push(i)
    animateClose(indices)
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
          const tid = tabIdentity(t)
          const isExiting = exitingIds.has(tid)
          const isActive = i === activeIndex
          const isHovered = hoveredIndex === i
          const isDragging = draggingIndex === i
          const isDropTarget = dropIndex === i && draggingIndex !== null && draggingIndex !== i
          const motionClass = isExiting ? 'dock-tab-exiting' : 'dock-tab-enter'
          return (
            <div
              key={tid}
              ref={(el) => {
                tabRefs.current[i] = el
              }}
              className={motionClass}
              role="tab"
              id={`dock-tab-${i}`}
              aria-selected={isActive}
              aria-controls={`dock-tab-panel-${i}`}
              tabIndex={isActive && !isExiting ? 0 : -1}
              aria-hidden={isExiting || undefined}
              draggable={!isExiting}
              onDragStart={(e) => {
                if (isExiting) return
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', String(i))
                setDraggingIndex(i)
              }}
              onDragOver={(e) => {
                if (draggingIndex === null || draggingIndex === i || isExiting) return
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
                if (from === null || Number.isNaN(from) || from === i || isExiting) return
                reorder(from, i)
                onActivate(i)
              }}
              onDragEnd={() => {
                setDraggingIndex(null)
                setDropIndex(null)
              }}
              onClick={() => {
                if (isExiting) return
                onActivate(i)
              }}
              onKeyDown={(e) => onTabKeyDown(e, i)}
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex((cur) => (cur === i ? null : cur))}
              onContextMenu={(e) => {
                if (isExiting) return
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
                background: isActive
                  ? colors.tab.bgActive
                  : isHovered
                    ? colors.tab.bgHover
                    : colors.tab.bg,
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
                transition: `background ${transitions.focusRing}, color ${transitions.focusRing}, opacity ${transitions.focusRing}`
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
                  animateClose([i])
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
                  transition: `opacity ${transitions.focusRing}`,
                  pointerEvents: isActive || isHovered ? 'auto' : 'none'
                }}
              >
                ×
              </button>
            </div>
          )
        })}
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
