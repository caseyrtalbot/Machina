import { useState } from 'react'
import { useThreadStore } from '../../store/thread-store'
import { DockTabBar } from './DockTabBar'
import { DockTabContent } from './DockTabContent'
import { colors } from '../../design/tokens'
import type { DockTab } from '@shared/dock-types'

const EMPTY_TABS: readonly DockTab[] = []

export function SurfaceDock() {
  const id = useThreadStore((s) => s.activeThreadId)
  const tabs = useThreadStore((s) => (id ? (s.dockTabsByThreadId[id] ?? EMPTY_TABS) : EMPTY_TABS))
  const collapsed = useThreadStore((s) => s.dockCollapsed)
  const [activeIndex, setActiveIndex] = useState(0)
  // Reset active tab on thread switch using the render-time prev-state pattern
  // required by the react-hooks/set-state-in-effect lint rule.
  const [prevId, setPrevId] = useState(id)
  if (id !== prevId) {
    setPrevId(id)
    setActiveIndex(0)
  }
  if (collapsed) return <aside data-testid="dock-collapsed" style={{ width: 0 }} />
  const safeIndex = activeIndex < tabs.length ? activeIndex : 0
  const active = tabs[safeIndex]
  return (
    <aside
      style={{
        width: 480,
        borderLeft: `1px solid ${colors.border.default}`,
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <DockTabBar activeIndex={safeIndex} onActivate={setActiveIndex} />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {active ? (
          <DockTabContent tab={active} />
        ) : (
          <div
            data-testid="dock-empty-state"
            style={{ padding: 24, color: colors.text.muted, fontSize: 13 }}
          >
            no surface tabs yet, hit + to open canvas, editor, graph, ghosts, or health
          </div>
        )}
      </div>
    </aside>
  )
}
