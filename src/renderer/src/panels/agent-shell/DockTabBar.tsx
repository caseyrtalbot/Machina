import { useThreadStore } from '../../store/thread-store'
import { useDockStore } from '../../store/dock-store'
import { type DockTab } from '@shared/dock-types'
import { TabBar, type TabBarItem } from '../../components/tabbar/TabBar'

const EMPTY_TABS: readonly DockTab[] = []

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

function tabLabel(tab: DockTab): string {
  switch (tab.kind) {
    case 'canvas':
      return tab.id === 'default' ? 'canvas' : tab.id
    default:
      // Kind-keyed surfaces (editor, graph, ghosts, health) label by kind;
      // the editor surface's own note-tab bar names the open notes.
      return tab.kind
  }
}

function tabTooltip(tab: DockTab): string | undefined {
  if (tab.kind === 'canvas' && tab.id !== 'default') return `canvas · ${tab.id}`
  return undefined
}

// Close dispatch resolves ids against the CURRENT store state: the animated
// close defers this call, and the tab list may shift between click and fire.
function closeByIds(ids: readonly string[]) {
  const threadId = useThreadStore.getState().activeThreadId
  const cur = useDockStore.getState()
  const list = threadId ? (cur.dockTabsByThreadId[threadId] ?? []) : []
  const indices: number[] = []
  for (let i = 0; i < list.length; i += 1) {
    if (ids.includes(tabIdentity(list[i]))) indices.push(i)
  }
  if (indices.length === 1) cur.removeDockTab(indices[0])
  else if (indices.length > 1) cur.removeDockTabs(indices)
}

export function DockTabBar({
  activeIndex,
  onActivate
}: {
  readonly activeIndex: number
  readonly onActivate: (i: number) => void
}) {
  const id = useThreadStore((s) => s.activeThreadId)
  const tabs = useDockStore((s) => (id ? (s.dockTabsByThreadId[id] ?? EMPTY_TABS) : EMPTY_TABS))
  const reorder = useDockStore((s) => s.reorderDockTab)

  const items: TabBarItem[] = tabs.map((t) => ({
    id: tabIdentity(t),
    label: tabLabel(t),
    tooltip: tabTooltip(t),
    closeLabel: `close ${t.kind} tab`
  }))

  return (
    <TabBar
      variant="underline"
      items={items}
      activeId={items[activeIndex]?.id ?? null}
      ariaLabel="Dock tabs"
      animated
      onActivate={(tabId) => {
        const i = items.findIndex((t) => t.id === tabId)
        if (i >= 0) onActivate(i)
      }}
      onClose={closeByIds}
      onReorder={(from, to) => {
        reorder(from, to)
        onActivate(to)
      }}
      contextMenu={(item, close) => {
        const index = items.findIndex((t) => t.id === item.id)
        return [
          {
            id: 'close',
            label: 'Close tab',
            onSelect: () => close([item.id])
          },
          {
            id: 'close-others',
            label: 'Close other tabs',
            disabled: items.length <= 1,
            onSelect: () => close(items.filter((t) => t.id !== item.id).map((t) => t.id))
          },
          {
            id: 'close-right',
            label: 'Close tabs to the right',
            disabled: index >= items.length - 1,
            onSelect: () => close(items.slice(index + 1).map((t) => t.id))
          }
        ]
      }}
    />
  )
}
