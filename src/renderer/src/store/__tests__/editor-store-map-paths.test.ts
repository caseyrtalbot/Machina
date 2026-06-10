import { beforeEach, describe, expect, it } from 'vitest'
import { useEditorStore } from '../editor-store'

describe('editor-store mapPaths (rename/move re-keying)', () => {
  beforeEach(() => {
    useEditorStore.setState(useEditorStore.getInitialState())
  })

  it('re-keys the active note, tabs, and history for a file rename', () => {
    useEditorStore.setState({
      activeNotePath: '/vault/old.md',
      openTabs: [
        { path: '/vault/old.md', title: 'old' },
        { path: '/vault/other.md', title: 'other' }
      ],
      historyStack: ['/vault/other.md', '/vault/old.md'],
      historyIndex: 1
    })

    useEditorStore.getState().mapPaths('/vault/old.md', '/vault/new.md')

    const state = useEditorStore.getState()
    expect(state.activeNotePath).toBe('/vault/new.md')
    expect(state.openTabs).toEqual([
      { path: '/vault/new.md', title: 'new' },
      { path: '/vault/other.md', title: 'other' }
    ])
    expect(state.historyStack).toEqual(['/vault/other.md', '/vault/new.md'])
  })

  it('re-keys paths under a renamed folder', () => {
    useEditorStore.setState({
      activeNotePath: '/vault/folder/nested/a.md',
      openTabs: [{ path: '/vault/folder/nested/a.md', title: 'a' }],
      historyStack: ['/vault/folder/nested/a.md'],
      historyIndex: 0
    })

    useEditorStore.getState().mapPaths('/vault/folder', '/vault/moved')

    const state = useEditorStore.getState()
    expect(state.activeNotePath).toBe('/vault/moved/nested/a.md')
    expect(state.openTabs[0].path).toBe('/vault/moved/nested/a.md')
  })

  it('does not touch unrelated paths sharing a prefix string', () => {
    useEditorStore.setState({
      activeNotePath: '/vault/folderish.md',
      openTabs: [{ path: '/vault/folderish.md', title: 'folderish' }],
      historyStack: ['/vault/folderish.md'],
      historyIndex: 0
    })

    useEditorStore.getState().mapPaths('/vault/folder', '/vault/moved')

    const state = useEditorStore.getState()
    expect(state.activeNotePath).toBe('/vault/folderish.md')
    expect(state.openTabs[0].path).toBe('/vault/folderish.md')
  })

  it('re-keys the preview tab path', () => {
    useEditorStore.setState({
      previewTabPath: '/vault/old.md',
      openTabs: [{ path: '/vault/old.md', title: 'old' }]
    })

    useEditorStore.getState().mapPaths('/vault/old.md', '/vault/new.md')

    expect(useEditorStore.getState().previewTabPath).toBe('/vault/new.md')
  })
})
