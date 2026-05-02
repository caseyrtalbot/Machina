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
  const [activeIndex, setActiveIndex] = useState(0)
  const active = tabs[activeIndex]
  if (!active) return <aside data-testid="dock-empty" style={{ width: 0 }} />
  return (
    <aside
      style={{
        width: 480,
        borderLeft: `1px solid ${colors.border.default}`,
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <DockTabBar activeIndex={activeIndex} onActivate={setActiveIndex} />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <DockTabContent tab={active} />
      </div>
    </aside>
  )
}
