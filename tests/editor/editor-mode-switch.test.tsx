import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useEditorStore } from '../../src/renderer/src/store/editor-store'

/**
 * Mode-switch round-trip through the real EditorPanel handlers
 * (handleModeChange / handleSourceChange), per the plan's 1.1 verification
 * matrix: edits made in source mode must survive the switch to rich, the
 * sync effect must not clobber the re-parsed content, and a pure toggle on
 * an unedited note must not mark the store dirty (which would rewrite the
 * file on switch-away).
 *
 * Tiptap is faked with an identity serialize/parse pair ({ __md }) so the
 * assertions track exact content flow through the component seam.
 */

const PATH = '/vault/note.md'
// parseFrontmatter's raw includes the closing delimiter + separator blank
// line so that raw + body === original (the recomposition seam).
const RAW_FM = '---\ntitle: Note\n---\n\n'
const BODY = '# Title\n\nhello\n'
const ORIGINAL = RAW_FM + BODY
const EDITED_BODY = '# Title\n\nhello world\n'
const EDITED = RAW_FM + EDITED_BODY

const tiptap = vi.hoisted(() => {
  let json: { __md: string } = { __md: '' }
  const setContentCalls: Array<{ __md: string }> = []
  const editor = {
    storage: {
      markdown: {
        manager: {
          serialize: (j: { __md: string }) => j.__md,
          parse: (md: string) => ({ __md: md })
        }
      }
    },
    commands: {
      setContent: (j: { __md: string }) => {
        json = j
        setContentCalls.push(j)
        return true
      },
      setTextSelection: () => true,
      scrollIntoView: () => true
    },
    getJSON: () => json,
    state: { doc: { descendants: () => {} } }
  }
  return {
    editor,
    setContentCalls,
    reset: () => {
      json = { __md: '' }
      setContentCalls.length = 0
    }
  }
})

vi.mock('@tiptap/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tiptap/react')>()
  return { ...actual, useEditor: () => tiptap.editor }
})

vi.mock('../../src/renderer/src/panels/editor/SourceEditor', () => ({
  SourceEditor: ({ content, onChange }: { content: string; onChange: (v: string) => void }) => (
    <textarea
      data-testid="source-editor"
      value={content}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}))

vi.mock('../../src/renderer/src/panels/editor/RichEditor', () => ({
  RichEditor: () => <div data-testid="rich-editor" />
}))

vi.mock('../../src/renderer/src/panels/editor/EditorBubbleMenu', () => ({
  EditorBubbleMenu: () => null
}))

vi.mock('../../src/renderer/src/panels/editor/FrontmatterHeader', () => ({
  FrontmatterHeader: () => null
}))

vi.mock('../../src/renderer/src/panels/editor/BacklinksPanel', () => ({
  BacklinksPanel: () => null
}))

vi.mock('../../src/renderer/src/store/vault-store', () => {
  const state = {
    fileToId: {} as Record<string, string>,
    artifacts: [] as never[],
    artifactPathById: {} as Record<string, string>,
    getBacklinks: () => []
  }
  const useVaultStore = Object.assign((sel: (s: typeof state) => unknown) => sel(state), {
    getState: () => state
  })
  return { useVaultStore }
})

vi.mock('../../src/renderer/src/store/ui-store', () => {
  const state = { outlineVisible: false }
  const useUiStore = Object.assign((sel: (s: typeof state) => unknown) => sel(state), {
    getState: () => state
  })
  return { useUiStore }
})

import { EditorPanel } from '../../src/renderer/src/panels/editor/EditorPanel'

function createApi() {
  return {
    document: {
      open: vi.fn().mockResolvedValue({ content: ORIGINAL, version: 0 }),
      close: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(1),
      save: vi.fn().mockResolvedValue(undefined),
      saveContent: vi.fn().mockResolvedValue(undefined)
    },
    on: {
      docExternalChange: vi.fn(() => () => {}),
      docConflict: vi.fn(() => () => {}),
      docSaved: vi.fn(() => () => {})
    }
  }
}

describe('EditorPanel source↔rich mode-switch round-trip', () => {
  let api: ReturnType<typeof createApi>

  beforeEach(() => {
    tiptap.reset()
    api = createApi()
    ;(window as unknown as { api: unknown }).api = api
    useEditorStore.setState(useEditorStore.getInitialState(), true)
    useEditorStore.setState({ activeNotePath: PATH, mode: 'rich' })
  })

  it('edits made in source mode survive the switch back to rich without clobber', async () => {
    render(<EditorPanel onNavigate={() => {}} />)

    // Initial load: frontmatter stripped, body parsed into Tiptap
    await waitFor(() => expect(tiptap.setContentCalls).toContainEqual({ __md: BODY }))

    // rich → source: seeded from raw frontmatter + serialized Tiptap doc
    fireEvent.click(screen.getByRole('tab', { name: 'Source' }))
    expect(useEditorStore.getState().content).toBe(ORIGINAL)

    // Edit in source mode: routes through DocumentManager (doc.update)
    fireEvent.change(screen.getByTestId('source-editor'), { target: { value: EDITED } })
    expect(api.document.update).toHaveBeenCalledWith(PATH, EDITED)
    expect(useEditorStore.getState().isDirty).toBe(true)

    // source → rich: the edited text (not stale doc content) lands in Tiptap
    fireEvent.click(screen.getByRole('tab', { name: 'Rich' }))
    expect(tiptap.setContentCalls.at(-1)).toEqual({ __md: EDITED_BODY })

    // The Tiptap sync effect must not re-apply the original content over the
    // re-parsed edits (prevLoadedPathRef reset + dirty bail-out).
    await waitFor(() => {
      expect(tiptap.setContentCalls.at(-1)).toEqual({ __md: EDITED_BODY })
      expect(tiptap.setContentCalls.filter((c) => c.__md === BODY)).toHaveLength(1)
    })
  })

  it('toggling rich→source→rich on an unedited note never marks the store dirty', async () => {
    render(<EditorPanel onNavigate={() => {}} />)
    await waitFor(() => expect(tiptap.setContentCalls).toContainEqual({ __md: BODY }))

    fireEvent.click(screen.getByRole('tab', { name: 'Source' }))
    expect(useEditorStore.getState().isDirty).toBe(false)
    expect(useEditorStore.getState().content).toBe(ORIGINAL)

    fireEvent.click(screen.getByRole('tab', { name: 'Rich' }))
    expect(useEditorStore.getState().isDirty).toBe(false)

    // No phantom writes: a pure toggle pushes nothing to DocumentManager,
    // so switch-away flushes have nothing to rewrite.
    expect(api.document.update).not.toHaveBeenCalled()
    expect(api.document.saveContent).not.toHaveBeenCalled()
  })
})
