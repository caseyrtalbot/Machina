import { describe, expect, it } from 'vitest'
import { normalizePersistedTabState } from '../tab-store'

describe('normalizePersistedTabState', () => {
  it('migrates legacy project canvas tabs to workbench', () => {
    const result = normalizePersistedTabState({
      tabs: [
        { id: 'editor', type: 'editor', label: 'Editor', closeable: false },
        {
          id: 'project-canvas',
          type: 'project-canvas',
          label: 'Project Canvas',
          closeable: true
        }
      ],
      activeTabId: 'project-canvas'
    })

    expect(result.activeTabId).toBe('workbench')
    expect(result.tabs).toContainEqual({
      id: 'workbench',
      type: 'workbench',
      label: 'Workbench',
      closeable: true
    })
  })

  it('restores missing default tabs when persisted state is empty', () => {
    const result = normalizePersistedTabState({ tabs: [], activeTabId: 'missing' })

    expect(result.tabs.map((tab) => tab.id)).toEqual(['editor', 'canvas'])
    expect(result.activeTabId).toBe('editor')
  })

  it('drops tabs with unknown types', () => {
    const result = normalizePersistedTabState({
      tabs: [
        { id: 'editor', type: 'editor', label: 'Editor', closeable: false },
        { id: 'bogus', type: 'nonexistent-panel', label: 'Bogus', closeable: true },
        { id: 'canvas', type: 'canvas', label: 'Vault Canvas', closeable: true }
      ],
      activeTabId: 'editor'
    })

    expect(result.tabs.map((tab) => tab.id)).toEqual(['editor', 'canvas'])
  })

  it('deduplicates tabs after legacy migration', () => {
    const result = normalizePersistedTabState({
      tabs: [
        { id: 'editor', type: 'editor', label: 'Editor', closeable: false },
        { id: 'project-canvas', type: 'project-canvas', label: 'Project Canvas', closeable: true },
        { id: 'workbench', type: 'workbench', label: 'Workbench', closeable: true }
      ],
      activeTabId: 'workbench'
    })

    const workbenchTabs = result.tabs.filter((tab) => tab.id === 'workbench')
    expect(workbenchTabs).toHaveLength(1)
  })

  it('always ensures editor tab exists even if missing from persisted data', () => {
    const result = normalizePersistedTabState({
      tabs: [
        { id: 'canvas', type: 'canvas', label: 'Vault Canvas', closeable: true },
        { id: 'workbench', type: 'workbench', label: 'Workbench', closeable: true }
      ],
      activeTabId: 'canvas'
    })

    expect(result.tabs[0]).toMatchObject({ id: 'editor', type: 'editor' })
  })

  it('forces editor tab to be non-closeable', () => {
    const result = normalizePersistedTabState({
      tabs: [{ id: 'editor', type: 'editor', label: 'Editor', closeable: true }],
      activeTabId: 'editor'
    })

    expect(result.tabs.find((tab) => tab.id === 'editor')?.closeable).toBe(false)
  })

  it('falls back to defaults when snapshot is null', () => {
    const result = normalizePersistedTabState(null)

    expect(result.tabs.map((tab) => tab.id)).toEqual(['editor', 'canvas'])
    expect(result.activeTabId).toBe('canvas')
  })

  it('resolves active tab to first tab when persisted active tab is gone', () => {
    const result = normalizePersistedTabState({
      tabs: [
        { id: 'editor', type: 'editor', label: 'Editor', closeable: false },
        { id: 'canvas', type: 'canvas', label: 'Vault Canvas', closeable: true }
      ],
      activeTabId: 'graph'
    })

    expect(result.activeTabId).toBe('editor')
  })
})
