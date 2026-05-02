import { useState } from 'react'
import { useThreadStore } from '../../store/thread-store'
import { DOCK_TAB_KINDS, type DockTab, type DockTabKind } from '@shared/dock-types'
import { colors } from '../../design/tokens'
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
              padding: '0 10px',
              height: '100%',
              background: isActive
                ? colors.tab.bgActive
                : isHovered
                  ? colors.tab.bgHover
                  : colors.tab.bg,
              border: 'none',
              borderRight: `1px solid ${colors.tab.border}`,
              color: isActive ? colors.tab.fgActive : colors.tab.fg,
              fontSize: 12,
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
                borderRadius: 3,
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
      <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'stretch' }}>
        <button
          aria-label="Add tab"
          title="Add tab"
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
            style={{
              position: 'absolute',
              top: TAB_BAR_HEIGHT,
              right: 0,
              background: colors.bg.elevated,
              border: `1px solid ${colors.border.default}`,
              minWidth: 120,
              zIndex: 10
            }}
          >
            {DOCK_TAB_KINDS.map((k) => (
              <div
                key={k}
                onClick={() => newTab(k)}
                style={{
                  padding: '6px 12px',
                  fontSize: 12,
                  color: colors.text.secondary,
                  cursor: 'pointer'
                }}
              >
                {k}
              </div>
            ))}
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
