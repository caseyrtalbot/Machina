import { useEffect, useRef, useState } from 'react'
import { useThreadStore } from '../../store/thread-store'
import { DOCK_TAB_KINDS, type DockTab, type DockTabKind } from '@shared/dock-types'
import { borderRadius, colors, typography, zIndex } from '../../design/tokens'
import { ContextMenu, type ContextMenuPosition } from '../../components/ContextMenu'

const EMPTY_TABS: readonly DockTab[] = []
const TAB_BAR_HEIGHT = 28

interface TabMenuTarget {
  readonly index: number
  readonly position: ContextMenuPosition
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
  const add = useThreadStore((s) => s.addDockTab)
  const [adderOpen, setAdderOpen] = useState(false)
  const [menu, setMenu] = useState<TabMenuTarget | null>(null)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [hoveredAdderItem, setHoveredAdderItem] = useState<DockTabKind | null>(null)
  const adderRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!adderOpen) return
    function onMouseDown(e: MouseEvent) {
      if (adderRef.current && !adderRef.current.contains(e.target as Node)) {
        setAdderOpen(false)
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setAdderOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [adderOpen])

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
    add(tab)
    onActivate(tabs.length)
  }

  function closeTab(index: number) {
    remove(index)
  }

  function closeOthers(keep: number) {
    const indices: number[] = []
    for (let i = 0; i < tabs.length; i += 1) if (i !== keep) indices.push(i)
    indices.reverse().forEach((i) => remove(i))
  }

  function closeToRight(from: number) {
    for (let i = tabs.length - 1; i > from; i -= 1) remove(i)
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        height: TAB_BAR_HEIGHT,
        flexShrink: 0,
        borderBottom: `1px solid ${colors.tab.border}`
      }}
    >
      {tabs.map((t, i) => {
        const isActive = i === activeIndex
        const isHovered = hoveredIndex === i
        return (
          <button
            key={i}
            onClick={() => onActivate(i)}
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
              background: isHovered && !isActive ? colors.tab.bgHover : 'transparent',
              border: 'none',
              borderBottom: isActive
                ? `1.5px solid ${colors.accent.default}`
                : `1px solid transparent`,
              color: isActive ? colors.tab.fgActive : colors.tab.fg,
              fontFamily: typography.fontFamily.mono,
              fontSize: typography.metadata.size,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              transition: 'background 100ms ease-out, color 100ms ease-out'
            }}
          >
            <span>{t.kind}</span>
            <span
              role="button"
              aria-label={`close ${t.kind} tab`}
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
                borderRadius: borderRadius.inline,
                fontSize: 11,
                lineHeight: 1,
                color: colors.text.muted,
                opacity: isActive || isHovered ? 1 : 0,
                transition: 'opacity 100ms ease-out',
                pointerEvents: isActive || isHovered ? 'auto' : 'none'
              }}
            >
              ×
            </span>
          </button>
        )
      })}
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
            width: 28,
            height: '100%',
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
              top: TAB_BAR_HEIGHT + 4,
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
