import { useCallback, useEffect, useRef, useState } from 'react'
import { useThreadStore } from '../../store/thread-store'
import { DockTabBar } from './DockTabBar'
import { DockTabContent } from './DockTabContent'
import { colors, typography } from '../../design/tokens'
import { DOCK_TAB_KINDS, type DockTab } from '@shared/dock-types'

const EMPTY_KIND_LIST = (() => {
  const kinds = DOCK_TAB_KINDS
  if (kinds.length <= 1) return kinds.join('')
  return `${kinds.slice(0, -1).join(', ')}, or ${kinds[kinds.length - 1]}`
})()

const EMPTY_TABS: readonly DockTab[] = []

export interface SurfaceDockProps {
  readonly width?: number
}

export function SurfaceDock({ width = 480 }: SurfaceDockProps = {}) {
  const id = useThreadStore((s) => s.activeThreadId)
  const tabs = useThreadStore((s) => (id ? (s.dockTabsByThreadId[id] ?? EMPTY_TABS) : EMPTY_TABS))
  const collapsed = useThreadStore((s) => s.dockCollapsed)
  const storedActiveIndex = useThreadStore((s) => (id ? (s.dockActiveIndexByThreadId[id] ?? 0) : 0))
  const setStoreActive = useThreadStore((s) => s.setDockActiveIndex)
  // Track per-thread tab counts so a freshly-added tab (command palette,
  // ribbon, etc.) becomes active without a follow-up click. The user's last
  // active tab per thread lives in the store and survives thread switches.
  const [prevLengthByThread, setPrevLengthByThread] = useState<Record<string, number>>({})
  if (id) {
    const prevLen = prevLengthByThread[id]
    if (prevLen === undefined) {
      setPrevLengthByThread((m) => ({ ...m, [id]: tabs.length }))
    } else if (tabs.length > prevLen) {
      setPrevLengthByThread((m) => ({ ...m, [id]: tabs.length }))
      setStoreActive(id, tabs.length - 1)
    } else if (tabs.length !== prevLen) {
      setPrevLengthByThread((m) => ({ ...m, [id]: tabs.length }))
    }
  }
  const onActivate = useCallback(
    (i: number) => {
      if (id) setStoreActive(id, i)
    },
    [id, setStoreActive]
  )
  const safeIndex = storedActiveIndex < tabs.length ? storedActiveIndex : 0
  const active = tabs[safeIndex]
  // Assign each tab object a stable identity so React keys survive reorders
  // and we can keep previously-activated tabs mounted across switches.
  const idMapRef = useRef<WeakMap<DockTab, string>>(new WeakMap())
  const idCounterRef = useRef(0)
  const tabId = (tab: DockTab): string => {
    const map = idMapRef.current
    let id = map.get(tab)
    if (!id) {
      idCounterRef.current += 1
      id = `t${idCounterRef.current}`
      map.set(tab, id)
    }
    return id
  }
  // Track which tab ids have been activated so previously-loaded tabs stay
  // mounted across switches. Tabs not yet visited are skipped to avoid eager
  // loading of every kind. Trimmed to currently-open tabs to free state on close.
  const [mountedIds, setMountedIds] = useState<readonly string[]>(() =>
    active ? [tabId(active)] : []
  )
  useEffect(() => {
    const openIds = new Set(tabs.map(tabId))
    const activeId = active ? tabId(active) : null
    setMountedIds((prev) => {
      const next = prev.filter((k) => openIds.has(k))
      if (activeId && !next.includes(activeId)) next.push(activeId)
      return next.length === prev.length && next.every((k, i) => k === prev[i]) ? prev : next
    })
    // tabId is stable per-tab object; safe to omit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, active])

  if (collapsed) return <aside data-testid="dock-collapsed" style={{ width: 0 }} />
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
      <DockTabBar activeIndex={safeIndex} onActivate={onActivate} />
      <div style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
        {active ? (
          tabs.map((tab) => {
            const key = tabId(tab)
            if (!mountedIds.includes(key)) return null
            const isActive = tab === active
            return (
              <div
                key={key}
                style={{
                  display: isActive ? 'block' : 'none',
                  height: '100%'
                }}
              >
                <DockTabContent tab={tab} />
              </div>
            )
          })
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
            no surface tabs yet, hit + to open {EMPTY_KIND_LIST}
          </div>
        )}
      </div>
    </aside>
  )
}
