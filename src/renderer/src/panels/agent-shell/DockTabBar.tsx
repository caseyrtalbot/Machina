import { useState } from 'react'
import { useThreadStore } from '../../store/thread-store'
import { DOCK_TAB_KINDS, type DockTab, type DockTabKind } from '@shared/dock-types'
import { colors } from '../../design/tokens'

const EMPTY_TABS: readonly DockTab[] = []

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

  return (
    <div style={{ display: 'flex', borderBottom: `1px solid ${colors.border.default}` }}>
      {tabs.map((t, i) => (
        <button
          key={i}
          onClick={() => onActivate(i)}
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
    </div>
  )
}
