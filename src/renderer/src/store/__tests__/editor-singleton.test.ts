import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useDockStore, openNoteInEditor } from '../dock-store'
import { useEditorStore } from '../editor-store'
import { useThreadStore } from '../thread-store'
import type { Thread } from '@shared/thread-types'

/**
 * Singleton editor surface (fix for the co-mounted-editor corruption bug).
 *
 * The editor dock tab is kind-keyed like graph/ghosts/health — note identity
 * lives ONLY in editor-store. Before this fix, editor dock tabs were keyed
 * `editor:${path}`, so opening two notes co-mounted two editor surfaces that
 * both read the single global activeNotePath and corrupted each other.
 */

const sampleThread = (id: string, tabs: Thread['dockState']['tabs']): Thread => ({
  id,
  agent: 'machina-native',
  model: 'claude-sonnet-4-6',
  started: '2026-05-01T13:00:00Z',
  lastMessage: '2026-05-01T13:00:00Z',
  title: 'Sample',
  dockState: { tabs },
  messages: []
})

beforeEach(() => {
  useDockStore.setState(useDockStore.getInitialState())
  useEditorStore.setState(useEditorStore.getInitialState())
  useThreadStore.setState(useThreadStore.getInitialState())
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).api = {
    document: { saveContent: vi.fn().mockResolvedValue(undefined) },
    fs: { fileExists: vi.fn().mockResolvedValue(true) }
  }
  useThreadStore.setState({ vaultPath: '/v', activeThreadId: 'a' })
})

describe('singleton editor dock surface', () => {
  it('opening two distinct notes yields ONE editor dock tab; both notes in editor-store', () => {
    openNoteInEditor('/v/a.md')
    openNoteInEditor('/v/b.md')

    const dockTabs = useDockStore.getState().dockTabsByThreadId['a']
    expect(dockTabs).toEqual([{ kind: 'editor' }])

    const editor = useEditorStore.getState()
    expect(editor.openTabs.map((t) => t.path)).toEqual(['/v/a.md', '/v/b.md'])
    expect(editor.activeNotePath).toBe('/v/b.md')
  })

  it('re-opening an open note focuses the editor tab without duplicating anything', () => {
    openNoteInEditor('/v/a.md')
    useDockStore.getState().openOrFocusDockTab({ kind: 'graph' })
    openNoteInEditor('/v/a.md')

    const s = useDockStore.getState()
    expect(s.dockTabsByThreadId['a']).toEqual([{ kind: 'editor' }, { kind: 'graph' }])
    expect(s.dockActiveIndexByThreadId['a']).toBe(0)
    expect(useEditorStore.getState().openTabs).toHaveLength(1)
  })

  it('preview open routes through editor-store preview semantics', () => {
    openNoteInEditor('/v/a.md', { preview: true })
    expect(useEditorStore.getState().previewTabPath).toBe('/v/a.md')
    openNoteInEditor('/v/b.md', { preview: true })
    const editor = useEditorStore.getState()
    // Preview tab is replaced, not accumulated.
    expect(editor.openTabs.map((t) => t.path)).toEqual(['/v/b.md'])
    expect(editor.previewTabPath).toBe('/v/b.md')
  })

  it('seed folds legacy per-path editor tabs into one and harvests their paths', () => {
    useDockStore
      .getState()
      .seedFromThreads([
        sampleThread('a', [
          { kind: 'editor', path: '/v/legacy1.md' } as never,
          { kind: 'graph' },
          { kind: 'editor', path: '/v/legacy2.md' } as never
        ])
      ])

    expect(useDockStore.getState().dockTabsByThreadId['a']).toEqual([
      { kind: 'editor' },
      { kind: 'graph' }
    ])
    expect(useEditorStore.getState().openTabs.map((t) => t.path)).toEqual([
      '/v/legacy1.md',
      '/v/legacy2.md'
    ])
  })

  it('seedThreadTabs applies the same folding (thread-creation path)', () => {
    useDockStore
      .getState()
      .seedThreadTabs('b', [
        { kind: 'editor', path: '/v/x.md' } as never,
        { kind: 'editor', path: '/v/x.md' } as never
      ])
    expect(useDockStore.getState().dockTabsByThreadId['b']).toEqual([{ kind: 'editor' }])
    // Duplicate legacy paths harvest once.
    expect(useEditorStore.getState().openTabs.map((t) => t.path)).toEqual(['/v/x.md'])
  })
})
