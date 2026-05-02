import { useState } from 'react'
import { useThreadStore } from '../../store/thread-store'
import { DOCK_TAB_KINDS, type DockTab, type DockTabKind } from '@shared/dock-types'
import { colors } from '../../design/tokens'
import { ContextMenu, type ContextMenuPosition } from '../../components/ContextMenu'

const EMPTY_TABS: readonly DockTab[] = []

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
    // remove from highest index to lowest, skipping `keep`
    const indices: number[] = []
    for (let i = 0; i < tabs.length; i += 1) if (i !== keep) indices.push(i)
    indices.reverse().forEach((i) => remove(i))
  }

  function closeToRight(from: number) {
    for (let i = tabs.length - 1; i > from; i -= 1) remove(i)
  }

  return (
    <div style={{ display: 'flex', borderBottom: `1px solid ${colors.border.default}` }}>
      {tabs.map((t, i) => (
        <button
          key={i}
          onClick={() => onActivate(i)}
          onContextMenu={(e) => {
            e.preventDefault()
            setMenu({ index: i, position: { x: e.clientX, y: e.clientY } })
          }}
          style={{
            padding: '4px 12px',
            background: i === activeIndex ? colors.bg.elevated : 'transparent',
            border: 'none',
            color: 'inherit',
            cursor: 'pointer'
          }}
        >
          {t.kind}
          <span
            onClick={(e) => {
              e.stopPropagation()
              remove(i)
            }}
            style={{ marginLeft: 8, opacity: 0.6 }}
          >
            ×
          </span>
        </button>
      ))}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setAdderOpen((v) => !v)}
          style={{
            padding: '4px 8px',
            background: 'transparent',
            border: 'none',
            color: 'inherit',
            cursor: 'pointer'
          }}
        >
          +
        </button>
        {adderOpen && (
          <div
            style={{
              position: 'absolute',
              top: 28,
              right: 0,
              background: colors.bg.elevated,
              border: `1px solid ${colors.border.default}`,
              zIndex: 10
            }}
          >
            {DOCK_TAB_KINDS.map((k) => (
              <div
                key={k}
                onClick={() => newTab(k)}
                style={{ padding: '4px 12px', cursor: 'pointer' }}
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
