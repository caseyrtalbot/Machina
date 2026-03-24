import { describe, test, expect, beforeEach } from 'vitest'
import { useSidebarFilterStore } from '../../src/renderer/src/store/sidebar-filter-store'

describe('useSidebarFilterStore', () => {
  beforeEach(() => {
    useSidebarFilterStore.setState({
      selectedTags: [],
      tagOperator: 'or',
      expandedTagPaths: new Set()
    })
  })

  test('starts with no selected tags', () => {
    expect(useSidebarFilterStore.getState().selectedTags).toEqual([])
  })

  test('toggleTag adds a tag', () => {
    useSidebarFilterStore.getState().toggleTag('react')
    expect(useSidebarFilterStore.getState().selectedTags).toEqual(['react'])
  })

  test('toggleTag removes an already-selected tag', () => {
    useSidebarFilterStore.getState().toggleTag('react')
    useSidebarFilterStore.getState().toggleTag('react')
    expect(useSidebarFilterStore.getState().selectedTags).toEqual([])
  })

  test('multiple tags can be selected', () => {
    useSidebarFilterStore.getState().toggleTag('react')
    useSidebarFilterStore.getState().toggleTag('vue')
    expect(useSidebarFilterStore.getState().selectedTags).toEqual(['react', 'vue'])
  })

  test('clearTags removes all selected tags', () => {
    useSidebarFilterStore.getState().toggleTag('react')
    useSidebarFilterStore.getState().toggleTag('vue')
    useSidebarFilterStore.getState().clearTags()
    expect(useSidebarFilterStore.getState().selectedTags).toEqual([])
  })

  test('default operator is "or"', () => {
    expect(useSidebarFilterStore.getState().tagOperator).toBe('or')
  })

  test('setTagOperator switches to "and"', () => {
    useSidebarFilterStore.getState().setTagOperator('and')
    expect(useSidebarFilterStore.getState().tagOperator).toBe('and')
  })

  test('toggleTagExpanded expands a path', () => {
    useSidebarFilterStore.getState().toggleTagExpanded('dev')
    expect(useSidebarFilterStore.getState().expandedTagPaths.has('dev')).toBe(true)
  })

  test('toggleTagExpanded collapses an expanded path', () => {
    useSidebarFilterStore.getState().toggleTagExpanded('dev')
    useSidebarFilterStore.getState().toggleTagExpanded('dev')
    expect(useSidebarFilterStore.getState().expandedTagPaths.has('dev')).toBe(false)
  })
})
