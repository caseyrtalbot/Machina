import { describe, expect, it, beforeEach } from 'vitest'
import { useTabStore } from '../tab-store'
import type { ViewTab } from '../tab-store'

const WORKBENCH_TAB: ViewTab = {
  id: 'workbench',
  type: 'workbench',
  label: 'Workbench',
  closeable: true
}

const GRAPH_TAB: ViewTab = {
  id: 'graph',
  type: 'graph',
  label: 'Graph',
  closeable: true
}

describe('tab-store live actions', () => {
  beforeEach(() => {
    // Reset to default state
    useTabStore.setState({
      tabs: [
        { id: 'editor', type: 'editor', label: 'Editor', closeable: false },
        { id: 'canvas', type: 'canvas', label: 'Vault Canvas', closeable: true }
      ],
      activeTabId: 'editor'
    })
  })

  it('openTab adds a new tab and activates it', () => {
    useTabStore.getState().openTab(WORKBENCH_TAB)

    const state = useTabStore.getState()
    expect(state.tabs).toHaveLength(3)
    expect(state.tabs[2].id).toBe('workbench')
    expect(state.activeTabId).toBe('workbench')
  })

  it('openTab on existing tab only activates it without duplicating', () => {
    useTabStore.getState().openTab(WORKBENCH_TAB)
    useTabStore.getState().openTab(WORKBENCH_TAB)

    const state = useTabStore.getState()
    expect(state.tabs.filter((t) => t.id === 'workbench')).toHaveLength(1)
    expect(state.activeTabId).toBe('workbench')
  })

  it('closeTab removes tab and shifts active to nearest neighbor', () => {
    useTabStore.getState().openTab(WORKBENCH_TAB)
    useTabStore.getState().openTab(GRAPH_TAB)
    useTabStore.getState().activateTab('workbench')

    useTabStore.getState().closeTab('workbench')

    const state = useTabStore.getState()
    expect(state.tabs.map((t) => t.id)).not.toContain('workbench')
    // Nearest neighbor at the same index position (graph shifted into workbench's slot)
    expect(state.activeTabId).toBe('graph')
  })

  it('closeTab does nothing for non-closeable tabs', () => {
    useTabStore.getState().closeTab('editor')

    expect(useTabStore.getState().tabs.map((t) => t.id)).toContain('editor')
  })

  it('activateTab switches to a valid tab', () => {
    useTabStore.getState().openTab(WORKBENCH_TAB)
    useTabStore.getState().activateTab('canvas')

    expect(useTabStore.getState().activeTabId).toBe('canvas')
  })

  it('activateTab ignores unknown tab ids', () => {
    useTabStore.getState().activateTab('nonexistent')

    expect(useTabStore.getState().activeTabId).toBe('editor')
  })

  it('reorderTab swaps tab positions', () => {
    useTabStore.getState().openTab(WORKBENCH_TAB)

    useTabStore.getState().reorderTab(1, 2)

    const ids = useTabStore.getState().tabs.map((t) => t.id)
    expect(ids).toEqual(['editor', 'workbench', 'canvas'])
  })
})
