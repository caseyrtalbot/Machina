import { describe, test, expect, beforeEach } from 'vitest'
import { useUiStore, rehydrateUiStore } from '../../src/renderer/src/store/ui-store'
import { useVaultStore } from '../../src/renderer/src/store/vault-store'

describe('useUiStore', () => {
  beforeEach(() => {
    useUiStore.setState(useUiStore.getInitialState())
  })

  test('defaults to collapsed (true) for unknown note paths', () => {
    expect(useUiStore.getState().getBacklinkCollapsed('/notes/a.md')).toBe(true)
  })

  test('toggleBacklinkCollapsed flips from default collapsed to expanded', () => {
    useUiStore.getState().toggleBacklinkCollapsed('/notes/a.md')
    expect(useUiStore.getState().getBacklinkCollapsed('/notes/a.md')).toBe(false)
  })

  test('toggleBacklinkCollapsed flips back to collapsed', () => {
    useUiStore.getState().toggleBacklinkCollapsed('/notes/a.md')
    useUiStore.getState().toggleBacklinkCollapsed('/notes/a.md')
    expect(useUiStore.getState().getBacklinkCollapsed('/notes/a.md')).toBe(true)
  })

  test('different note paths are independent', () => {
    useUiStore.getState().toggleBacklinkCollapsed('/notes/a.md')
    expect(useUiStore.getState().getBacklinkCollapsed('/notes/a.md')).toBe(false)
    expect(useUiStore.getState().getBacklinkCollapsed('/notes/b.md')).toBe(true)
  })

  test('outlineVisible defaults to false', () => {
    expect(useUiStore.getState().outlineVisible).toBe(false)
  })

  test('toggleOutline flips visibility', () => {
    useUiStore.getState().toggleOutline()
    expect(useUiStore.getState().outlineVisible).toBe(true)
    useUiStore.getState().toggleOutline()
    expect(useUiStore.getState().outlineVisible).toBe(false)
  })

  test('bookmarkedPaths defaults to empty', () => {
    expect(useUiStore.getState().bookmarkedPaths).toEqual([])
  })

  test('toggleBookmark adds a path', () => {
    useUiStore.getState().toggleBookmark('/notes/a.md')
    expect(useUiStore.getState().bookmarkedPaths).toEqual(['/notes/a.md'])
    expect(useUiStore.getState().isBookmarked('/notes/a.md')).toBe(true)
  })

  test('toggleBookmark removes existing path', () => {
    useUiStore.getState().toggleBookmark('/notes/a.md')
    useUiStore.getState().toggleBookmark('/notes/a.md')
    expect(useUiStore.getState().bookmarkedPaths).toEqual([])
    expect(useUiStore.getState().isBookmarked('/notes/a.md')).toBe(false)
  })

  test('toggleBookmark preserves other bookmarks', () => {
    useUiStore.getState().toggleBookmark('/notes/a.md')
    useUiStore.getState().toggleBookmark('/notes/b.md')
    useUiStore.getState().toggleBookmark('/notes/a.md')
    expect(useUiStore.getState().bookmarkedPaths).toEqual(['/notes/b.md'])
  })

  test('graphTutorialDismissed defaults to false', () => {
    expect(useUiStore.getState().graphTutorialDismissed).toBe(false)
  })

  test('dismissGraphTutorial sets the flag', () => {
    useUiStore.getState().dismissGraphTutorial()
    expect(useUiStore.getState().graphTutorialDismissed).toBe(true)
  })

  test('fileTreeCollapseState defaults to empty', () => {
    expect(useUiStore.getState().fileTreeCollapseState).toEqual({})
  })

  test('toggleFileTreeCollapsed collapses a directory', () => {
    useUiStore.getState().toggleFileTreeCollapsed('/vault/docs')
    expect(useUiStore.getState().fileTreeCollapseState).toEqual({ '/vault/docs': true })
  })

  test('toggleFileTreeCollapsed expands a collapsed directory (entry removed)', () => {
    useUiStore.getState().toggleFileTreeCollapsed('/vault/docs')
    useUiStore.getState().toggleFileTreeCollapsed('/vault/docs')
    expect(useUiStore.getState().fileTreeCollapseState).toEqual({})
  })

  test('toggleFileTreeCollapsed keeps other directories intact', () => {
    useUiStore.getState().toggleFileTreeCollapsed('/vault/a')
    useUiStore.getState().toggleFileTreeCollapsed('/vault/b')
    useUiStore.getState().toggleFileTreeCollapsed('/vault/a')
    expect(useUiStore.getState().fileTreeCollapseState).toEqual({ '/vault/b': true })
  })

  test('rehydrate restores persisted state', () => {
    useUiStore.getState().rehydrate({
      backlinkCollapsed: { '/notes/a.md': false, '/notes/b.md': true },
      dismissedGhosts: ['g1'],
      outlineVisible: true,
      bookmarkedPaths: ['/notes/x.md'],
      graphTutorialDismissed: true,
      fileTreeCollapseState: { '/vault/docs': true }
    })
    const s = useUiStore.getState()
    expect(s.getBacklinkCollapsed('/notes/a.md')).toBe(false)
    expect(s.getBacklinkCollapsed('/notes/b.md')).toBe(true)
    expect(s.dismissedGhosts).toEqual(['g1'])
    expect(s.outlineVisible).toBe(true)
    expect(s.bookmarkedPaths).toEqual(['/notes/x.md'])
    expect(s.graphTutorialDismissed).toBe(true)
    expect(s.fileTreeCollapseState).toEqual({ '/vault/docs': true })
  })

  test('rehydrate with empty input resets to defaults', () => {
    useUiStore.getState().toggleBacklinkCollapsed('/notes/a.md')
    useUiStore.getState().toggleFileTreeCollapsed('/vault/docs')
    useUiStore.getState().rehydrate({
      backlinkCollapsed: {},
      dismissedGhosts: [],
      outlineVisible: false,
      bookmarkedPaths: [],
      graphTutorialDismissed: false,
      fileTreeCollapseState: {}
    })
    expect(useUiStore.getState().getBacklinkCollapsed('/notes/a.md')).toBe(true)
    expect(useUiStore.getState().fileTreeCollapseState).toEqual({})
  })
})

describe('rehydrateUiStore', () => {
  beforeEach(() => {
    useUiStore.setState(useUiStore.getInitialState())
  })

  test('reads ui state and fileTreeCollapseState from the loaded VaultState', () => {
    useVaultStore.setState({
      state: {
        version: 1,
        lastOpenNote: null,
        fileTreeCollapseState: { '/vault/docs': true },
        ui: {
          backlinkCollapsed: { '/x.md': false },
          dismissedGhosts: ['g1'],
          outlineVisible: true,
          bookmarkedPaths: ['/p.md'],
          graphTutorialDismissed: true
        }
      }
    })

    rehydrateUiStore()

    const s = useUiStore.getState()
    expect(s.getBacklinkCollapsed('/x.md')).toBe(false)
    expect(s.dismissedGhosts).toEqual(['g1'])
    expect(s.outlineVisible).toBe(true)
    expect(s.bookmarkedPaths).toEqual(['/p.md'])
    expect(s.graphTutorialDismissed).toBe(true)
    expect(s.fileTreeCollapseState).toEqual({ '/vault/docs': true })
  })

  test('handles a missing ui field gracefully', () => {
    useVaultStore.setState({
      state: {
        version: 1,
        lastOpenNote: null,
        fileTreeCollapseState: {}
      }
    })

    rehydrateUiStore()

    expect(useUiStore.getState().getBacklinkCollapsed('/notes/a.md')).toBe(true)
    expect(useUiStore.getState().graphTutorialDismissed).toBe(false)
  })

  test('handles a null vault state gracefully', () => {
    useVaultStore.setState({ state: null })

    rehydrateUiStore()

    expect(useUiStore.getState().fileTreeCollapseState).toEqual({})
  })
})
