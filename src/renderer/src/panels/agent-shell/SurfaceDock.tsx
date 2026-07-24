import { useCallback, useState } from 'react'
import { useThreadStore } from '../../store/thread-store'
import { useDockStore } from '../../store/dock-store'
import { DockTabBar } from './DockTabBar'
import { DockTabContent } from './DockTabContent'
import { EmptyState } from '../../components/emptystate/EmptyState'
import { type DockTab } from '@shared/dock-types'
import { TerminalStrip } from './TerminalStrip'

const EMPTY_TABS: readonly DockTab[] = []

// Module-scoped identity for DockTab objects. WeakMap lets entries be garbage
// collected when the tab object is dropped from the store, so this never grows.
// Lives outside the component so render-time access is not a ref read.
const tabIdMap = new WeakMap<DockTab, string>()
let tabIdCounter = 0
function tabIdentity(tab: DockTab): string {
  const cached = tabIdMap.get(tab)
  if (cached) return cached
  tabIdCounter += 1
  const id = `t${tabIdCounter}`
  tabIdMap.set(tab, id)
  return id
}

export function SurfaceDock() {
  const id = useThreadStore((s) => s.activeThreadId)
  const tabs = useDockStore((s) => (id ? (s.dockTabsByThreadId[id] ?? EMPTY_TABS) : EMPTY_TABS))
  const collapsed = useDockStore((s) => s.dockCollapsed)
  const storedActiveIndex = useDockStore((s) => (id ? (s.dockActiveIndexByThreadId[id] ?? 0) : 0))
  const setStoreActive = useDockStore((s) => s.setDockActiveIndex)
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
  // Track which tab ids have been activated so previously-loaded tabs stay
  // mounted across switches. Tabs not yet visited are skipped to avoid eager
  // loading of every kind. Trimmed to currently-open tabs to free state on close.
  // Synced during render — React's recommended pattern for state derived from
  // props, see https://react.dev/reference/react/useState#storing-information-from-previous-renders.
  const [mountedIds, setMountedIds] = useState<readonly string[]>(() =>
    active ? [tabIdentity(active)] : []
  )
  const [syncSnapshot, setSyncSnapshot] = useState<{
    readonly tabs: readonly DockTab[]
    readonly active: DockTab | undefined
  }>({ tabs, active })
  if (syncSnapshot.tabs !== tabs || syncSnapshot.active !== active) {
    setSyncSnapshot({ tabs, active })
    const openIds = new Set(tabs.map(tabIdentity))
    const activeId = active ? tabIdentity(active) : null
    const next = mountedIds.filter((k) => openIds.has(k))
    if (activeId && !next.includes(activeId)) next.push(activeId)
    const changed = next.length !== mountedIds.length || !next.every((k, i) => k === mountedIds[i])
    if (changed) setMountedIds(next)
  }

  if (collapsed) return <aside data-testid="dock-collapsed" className="te-dock-collapsed" />
  return (
    // The dock is the workbench: te-dock-surface flexes to claim all width the
    // fixed-size rails (sidebar, chat, ribbon, files panel) leave over.
    <aside className="te-dock-surface">
      <DockTabBar activeIndex={safeIndex} onActivate={onActivate} />
      <div className="te-dock-content">
        {active ? (
          tabs.map((tab) => {
            const key = tabIdentity(tab)
            if (!mountedIds.includes(key)) return null
            const isActive = tab === active
            return (
              <div
                key={key}
                className="te-dock-tab-pane"
                style={{ display: isActive ? 'block' : 'none' }}
              >
                <DockTabContent tab={tab} />
              </div>
            )
          })
        ) : (
          <EmptyDockState />
        )}
      </div>
      <TerminalStrip />
    </aside>
  )
}

function EmptyDockState() {
  return (
    <EmptyState
      testId="dock-empty-state"
      maxWidth={280}
      eyebrow="no surface open"
      hint={
        <span className="te-dock-empty-hint">
          use the ribbon on the right edge to open the editor, canvas, graph, ghosts, or health, or
          press ⌘K for the command palette
        </span>
      }
    />
  )
}
