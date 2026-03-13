import { describe, it, expect } from 'vitest'
import { CONTEXT_MENU_ITEMS } from '../../src/renderer/src/panels/graph/GraphContextMenu'

describe('GraphContextMenu', () => {
  it('has exactly 4 menu items', () => {
    expect(CONTEXT_MENU_ITEMS).toHaveLength(4)
  })
  it('marks only Delete as dangerous', () => {
    const dangerous = CONTEXT_MENU_ITEMS.filter((i) => i.dangerous)
    expect(dangerous).toHaveLength(1)
    expect(dangerous[0].action).toBe('delete')
  })
  it('has unique action identifiers', () => {
    const actions = CONTEXT_MENU_ITEMS.map((i) => i.action)
    expect(new Set(actions).size).toBe(actions.length)
  })
  it('has non-empty labels for all items', () => {
    for (const item of CONTEXT_MENU_ITEMS) {
      expect(item.label.length).toBeGreaterThan(0)
    }
  })
})
