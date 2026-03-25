import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export type TabType = 'editor' | 'canvas' | 'workbench' | 'graph'

export interface ViewTab {
  readonly id: string
  readonly type: TabType
  readonly label: string
  readonly closeable: boolean
}

interface TabState {
  readonly tabs: readonly ViewTab[]
  readonly activeTabId: string
}

interface TabActions {
  openTab: (tab: ViewTab) => void
  activateTab: (id: string) => void
  closeTab: (id: string) => void
  reorderTab: (fromIndex: number, toIndex: number) => void
}

type TabStore = TabState & TabActions

const TAB_TYPES = ['editor', 'canvas', 'workbench', 'graph'] as const
const LEGACY_WORKBENCH_TAB_ID = 'project-canvas'

export const TAB_DEFINITIONS: Record<TabType, { label: string; iconId: string }> = {
  editor: { label: 'Editor', iconId: 'editor' },
  canvas: { label: 'Vault Canvas', iconId: 'canvas' },
  workbench: { label: 'Workbench', iconId: 'workbench' },
  graph: { label: 'Graph', iconId: 'graph' }
}

const DEFAULT_TABS: readonly ViewTab[] = [
  { id: 'editor', type: 'editor', label: 'Editor', closeable: false },
  { id: 'canvas', type: 'canvas', label: 'Vault Canvas', closeable: true }
]

interface PersistedViewTab {
  readonly id: string
  readonly type: string
  readonly label: string
  readonly closeable: boolean
}

interface PersistedTabSnapshot {
  readonly tabs?: readonly PersistedViewTab[]
  readonly activeTabId?: string
}

function isTabType(value: string): value is TabType {
  return (TAB_TYPES as readonly string[]).includes(value)
}

function normalizeTabId(value: string): string {
  return value === LEGACY_WORKBENCH_TAB_ID ? 'workbench' : value
}

function normalizeTabType(value: string): TabType | null {
  const normalized = value === LEGACY_WORKBENCH_TAB_ID ? 'workbench' : value
  return isTabType(normalized) ? normalized : null
}

function normalizePersistedTab(tab: PersistedViewTab): ViewTab | null {
  const type = normalizeTabType(tab.type)
  if (!type) return null

  const definition = TAB_DEFINITIONS[type]
  const normalizedLabel =
    tab.label === 'Project Canvas' || tab.label === 'Workbench' ? definition.label : tab.label

  return {
    id: normalizeTabId(tab.id),
    type,
    label: normalizedLabel || definition.label,
    closeable: type === 'editor' ? false : tab.closeable
  }
}

export function normalizePersistedTabState(snapshot: PersistedTabSnapshot | undefined | null): {
  readonly tabs: readonly ViewTab[]
  readonly activeTabId: string
} {
  const rawTabs = snapshot?.tabs ?? DEFAULT_TABS
  const normalizedTabs: ViewTab[] = []
  const seenIds = new Set<string>()

  for (const rawTab of rawTabs) {
    const normalizedTab = normalizePersistedTab(rawTab)
    if (!normalizedTab || seenIds.has(normalizedTab.id)) continue
    seenIds.add(normalizedTab.id)
    normalizedTabs.push(normalizedTab)
  }

  if (!seenIds.has('editor')) {
    normalizedTabs.unshift(DEFAULT_TABS[0])
    seenIds.add('editor')
  }

  if (normalizedTabs.length === 1 && normalizedTabs[0].id === 'editor') {
    normalizedTabs.push(DEFAULT_TABS[1])
  }

  const activeTabId = normalizeTabId(snapshot?.activeTabId ?? 'canvas')
  return {
    tabs: normalizedTabs,
    activeTabId: normalizedTabs.some((tab) => tab.id === activeTabId)
      ? activeTabId
      : (normalizedTabs[0]?.id ?? 'editor')
  }
}

export const useTabStore = create<TabStore>()(
  persist(
    (set, get) => ({
      tabs: DEFAULT_TABS,
      activeTabId: 'canvas',

      openTab: (tab) => {
        const { tabs } = get()
        const exists = tabs.find((t) => t.id === tab.id)
        if (exists) {
          set({ activeTabId: tab.id })
          return
        }
        set({ tabs: [...tabs, tab], activeTabId: tab.id })
      },

      activateTab: (id) => {
        const { tabs } = get()
        if (tabs.find((t) => t.id === id)) {
          set({ activeTabId: id })
        }
      },

      closeTab: (id) => {
        const { tabs, activeTabId } = get()
        const tab = tabs.find((t) => t.id === id)
        if (!tab || !tab.closeable) return

        const idx = tabs.indexOf(tab)
        const next = tabs.filter((t) => t.id !== id)

        let nextActive = activeTabId
        if (activeTabId === id) {
          // Activate nearest left neighbor, or right if leftmost
          const neighbor = next[Math.min(idx, next.length - 1)]
          nextActive = neighbor?.id ?? 'editor'
        }

        set({ tabs: next, activeTabId: nextActive })
      },

      reorderTab: (fromIndex, toIndex) => {
        const { tabs } = get()
        if (fromIndex < 0 || fromIndex >= tabs.length) return
        if (toIndex < 0 || toIndex >= tabs.length) return

        const updated = [...tabs]
        const [moved] = updated.splice(fromIndex, 1)
        updated.splice(toIndex, 0, moved)
        set({ tabs: updated })
      }
    }),
    {
      name: 'machina-tabs',
      version: 3,
      storage: createJSONStorage(() => localStorage),
      migrate: (persistedState) =>
        normalizePersistedTabState(persistedState as PersistedTabSnapshot),
      partialize: (state) => ({
        tabs: state.tabs,
        activeTabId: state.activeTabId
      })
    }
  )
)
