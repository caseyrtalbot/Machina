import { useState } from 'react'
import { useThreadStore } from '../../store/thread-store'
import { DockTabBar } from './DockTabBar'
import { DockTabContent } from './DockTabContent'
import { colors, typography } from '../../design/tokens'
import type { DockTab } from '@shared/dock-types'

const EMPTY_TABS: readonly DockTab[] = []

export interface SurfaceDockProps {
  readonly width?: number
}

export function SurfaceDock({ width = 480 }: SurfaceDockProps = {}) {
  const id = useThreadStore((s) => s.activeThreadId)
  const tabs = useThreadStore((s) => (id ? (s.dockTabsByThreadId[id] ?? EMPTY_TABS) : EMPTY_TABS))
  const collapsed = useThreadStore((s) => s.dockCollapsed)
  const [activeIndex, setActiveIndex] = useState(0)
  // Keep tab activation in render-time state transitions so command-palette and
  // ribbon-opened tabs become visible without a follow-up click.
  const [prevDockSnapshot, setPrevDockSnapshot] = useState({ id, length: tabs.length })
  if (id !== prevDockSnapshot.id) {
    setPrevDockSnapshot({ id, length: tabs.length })
    setActiveIndex(0)
  } else if (tabs.length > prevDockSnapshot.length) {
    setPrevDockSnapshot({ id, length: tabs.length })
    setActiveIndex(tabs.length - 1)
  } else if (tabs.length !== prevDockSnapshot.length) {
    setPrevDockSnapshot({ id, length: tabs.length })
  }
  if (collapsed) return <aside data-testid="dock-collapsed" style={{ width: 0 }} />
  const safeIndex = activeIndex < tabs.length ? activeIndex : 0
  const active = tabs[safeIndex]
  return (
    <aside
      style={{
        width,
        flexShrink: 0,
        background: colors.bg.rail,
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
            style={{
              padding: 24,
              color: colors.text.muted,
              fontFamily: typography.fontFamily.mono,
              fontSize: 11,
              letterSpacing: '0.04em',
              lineHeight: 1.6
            }}
          >
            no surface tabs yet, hit + to open canvas, editor, graph, ghosts, or health
          </div>
        )}
      </div>
    </aside>
  )
}
