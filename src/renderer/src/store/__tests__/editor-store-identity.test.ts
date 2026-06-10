import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorStore } from '../editor-store'

describe('editor-store path identity', () => {
  beforeEach(() => {
    window.api = {
      document: {
        saveContent: vi.fn().mockResolvedValue(undefined)
      }
    } as never

    useEditorStore.setState({
      activeNotePath: null,
      mode: 'rich',
      isDirty: false,
      content: '',
      openTabs: [],
      historyStack: [],
      historyIndex: -1
    })
  })

  it('setActiveNote accepts a path as the source of truth', () => {
    const setActiveNote = useEditorStore.getState().setActiveNote as unknown as (
      path: string | null
    ) => void

    setActiveNote('/vault/notes/hello.md')

    const state = useEditorStore.getState()
    expect(state.activeNotePath).toBe('/vault/notes/hello.md')
    expect(state.openTabs).toContainEqual({
      path: '/vault/notes/hello.md',
      title: 'hello'
    })
    expect(state.historyStack).toEqual(['/vault/notes/hello.md'])
  })

  it('tracks open, switch, back, and forward navigation by path', () => {
    const store = useEditorStore.getState()

    store.openTab('/vault/notes/hello.md', 'Hello')
    store.openTab('/vault/notes/world.md', 'World')
    store.switchTab('/vault/notes/hello.md')
    store.goBack()
    expect(useEditorStore.getState().activeNotePath).toBe('/vault/notes/world.md')

    store.goForward()
    expect(useEditorStore.getState().activeNotePath).toBe('/vault/notes/hello.md')
  })

  it('keeps tab closing behavior path-based', () => {
    const store = useEditorStore.getState()

    store.openTab('/vault/notes/hello.md', 'Hello')
    store.openTab('/vault/notes/world.md', 'World')
    store.closeTab('/vault/notes/world.md')

    const state = useEditorStore.getState()
    expect(state.activeNotePath).toBe('/vault/notes/hello.md')
    expect(state.openTabs.map((tab) => tab.path)).toEqual(['/vault/notes/hello.md'])
  })
})
