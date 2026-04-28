import { create } from 'zustand'
import { isSystemArtifactPath } from '@shared/system-artifacts'
import { logError } from '../utils/error-logger'

type EditorMode = 'rich' | 'source'

interface Tab {
  readonly path: string
  readonly title: string
}

interface EditorStore {
  readonly activeNotePath: string | null
  readonly mode: EditorMode
  readonly isDirty: boolean
  readonly content: string
  readonly cursorLine: number
  readonly cursorCol: number

  // Split pane
  readonly splitNotePath: string | null

  // Tabs
  readonly openTabs: readonly Tab[]
  /** Path of the transient preview tab (single-click). Null = no preview tab. */
  readonly previewTabPath: string | null

  // Navigation history
  readonly historyStack: readonly string[]
  readonly historyIndex: number

  // Pending scroll target for [[Note#heading]] navigation
  readonly pendingScrollTarget: string | null

  setActiveNote: (path: string | null) => void
  setMode: (mode: EditorMode) => void
  setContent: (content: string) => void
  loadContent: (content: string) => void
  setDirty: (dirty: boolean) => void
  markSaved: () => void
  setCursorPosition: (line: number, col: number) => void

  setPendingScrollTarget: (heading: string | null) => void

  openSplit: (path: string) => void
  closeSplit: () => void

  openTab: (path: string, title?: string) => void
  /** Open file in a transient preview tab. Replaced by the next preview open. */
  openPreviewTab: (path: string, title?: string) => void
  /** Promote the current preview tab to a permanent (pinned) tab. */
  pinPreviewTab: () => void
  closeTab: (path: string) => void
  switchTab: (path: string) => void
  goBack: () => void
  goForward: () => void
}

function titleFromPath(path: string): string {
  const filename = path.split('/').pop() ?? path
  return filename.replace(/\.md$/, '')
}

const MAX_HISTORY = 100

function pushHistory(
  stack: readonly string[],
  index: number,
  path: string
): { stack: readonly string[]; index: number } {
  const truncated = stack.slice(0, index + 1)
  if (truncated[truncated.length - 1] === path) {
    return { stack: truncated, index }
  }
  const next = [...truncated, path]
  // Cap history to prevent unbounded growth in long sessions
  if (next.length > MAX_HISTORY) {
    const excess = next.length - MAX_HISTORY
    return { stack: next.slice(excess), index: next.length - excess - 1 }
  }
  return { stack: next, index: next.length - 1 }
}

interface DirtyEditorState {
  isDirty: boolean
  activeNotePath: string | null
  content: string
}

async function persistDirtyDocument(
  state: DirtyEditorState,
  options: { readonly markSavedOnSuccess: boolean }
): Promise<void> {
  if (!state.isDirty || !state.activeNotePath) return
  const path = state.activeNotePath

  try {
    await window.api.document.saveContent(path, state.content)
    if (isSystemArtifactPath(path)) {
      const { syncSystemArtifactFromDisk } =
        await import('../system-artifacts/system-artifact-runtime')
      await syncSystemArtifactFromDisk(path)
    }
    if (options.markSavedOnSuccess && useEditorStore.getState().activeNotePath === path) {
      useEditorStore.getState().markSaved()
    }
  } catch (err) {
    logError('editor-save', err)
    if (useEditorStore.getState().activeNotePath === path) {
      useEditorStore.setState({ isDirty: true })
    }
  }
}

/**
 * Save current content if dirty via DocumentManager. Fire-and-forget.
 * Used internally by store actions before switching away from the active file.
 */
function flushIfDirty(state: DirtyEditorState): void {
  void persistDirtyDocument(state, { markSavedOnSuccess: false })
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  activeNotePath: null,
  mode: 'rich',
  isDirty: false,
  content: '',
  cursorLine: 1,
  cursorCol: 1,
  splitNotePath: null,
  openTabs: [],
  previewTabPath: null,
  historyStack: [],
  historyIndex: -1,
  pendingScrollTarget: null,

  setActiveNote: (path) => {
    if (!path) {
      set({ activeNotePath: null, isDirty: false })
      return
    }

    const state = get()
    flushIfDirty(state)
    const title = titleFromPath(path)
    const tabs = state.openTabs.some((t) => t.path === path)
      ? state.openTabs
      : [...state.openTabs, { path, title }]
    const history = pushHistory(state.historyStack, state.historyIndex, path)

    set({
      activeNotePath: path,
      isDirty: false,
      openTabs: tabs,
      historyStack: history.stack,
      historyIndex: history.index
    })
  },

  setMode: (mode) => set({ mode }),
  setContent: (content) => set({ content, isDirty: true }),
  loadContent: (content) => set({ content, isDirty: false }),
  setDirty: (dirty) => set({ isDirty: dirty }),
  markSaved: () => set({ isDirty: false }),
  setCursorPosition: (line, col) => set({ cursorLine: line, cursorCol: col }),

  setPendingScrollTarget: (heading) => set({ pendingScrollTarget: heading }),

  openSplit: (path) => set({ splitNotePath: path }),
  closeSplit: () => set({ splitNotePath: null }),

  openTab: (path, title) => {
    const state = get()
    flushIfDirty(state)
    const resolvedTitle = title ?? titleFromPath(path)
    const tabs = state.openTabs.some((t) => t.path === path)
      ? state.openTabs
      : [...state.openTabs, { path, title: resolvedTitle }]
    const history = pushHistory(state.historyStack, state.historyIndex, path)

    set({
      activeNotePath: path,
      isDirty: false,
      openTabs: tabs,
      // Opening a tab explicitly always pins it
      previewTabPath: state.previewTabPath === path ? null : state.previewTabPath,
      historyStack: history.stack,
      historyIndex: history.index
    })
  },

  openPreviewTab: (path, title) => {
    const state = get()
    flushIfDirty(state)

    // If this file is already in a pinned tab, just switch to it
    if (state.openTabs.some((t) => t.path === path) && state.previewTabPath !== path) {
      const history = pushHistory(state.historyStack, state.historyIndex, path)
      set({
        activeNotePath: path,
        isDirty: false,
        historyStack: history.stack,
        historyIndex: history.index
      })
      return
    }

    const resolvedTitle = title ?? titleFromPath(path)
    // Replace the existing preview tab with this one
    let tabs: readonly Tab[]
    if (state.previewTabPath && state.previewTabPath !== path) {
      tabs = state.openTabs
        .filter((t) => t.path !== state.previewTabPath)
        .concat([{ path, title: resolvedTitle }])
    } else if (state.openTabs.some((t) => t.path === path)) {
      tabs = state.openTabs
    } else {
      tabs = [...state.openTabs, { path, title: resolvedTitle }]
    }

    const history = pushHistory(state.historyStack, state.historyIndex, path)
    set({
      activeNotePath: path,
      isDirty: false,
      openTabs: tabs,
      previewTabPath: path,
      historyStack: history.stack,
      historyIndex: history.index
    })
  },

  pinPreviewTab: () => {
    set({ previewTabPath: null })
  },

  closeTab: (path) => {
    const state = get()
    if (state.activeNotePath === path) {
      flushIfDirty(state)
    }
    const tabs = state.openTabs.filter((t) => t.path !== path)
    const clearPreview = state.previewTabPath === path ? null : state.previewTabPath

    if (state.activeNotePath === path) {
      const oldIndex = state.openTabs.findIndex((t) => t.path === path)
      const nextTab = tabs[Math.min(oldIndex, tabs.length - 1)] ?? null

      set({
        openTabs: tabs,
        activeNotePath: nextTab?.path ?? null,
        previewTabPath: clearPreview,
        isDirty: false
      })
    } else {
      set({ openTabs: tabs, previewTabPath: clearPreview })
    }
  },

  switchTab: (path) => {
    const state = get()
    flushIfDirty(state)
    if (state.activeNotePath === path) return
    const history = pushHistory(state.historyStack, state.historyIndex, path)

    set({
      activeNotePath: path,
      isDirty: false,
      historyStack: history.stack,
      historyIndex: history.index
    })
  },

  goBack: () => {
    const state = get()
    flushIfDirty(state)
    if (state.historyIndex <= 0) return
    const newIndex = state.historyIndex - 1
    const path = state.historyStack[newIndex]

    set({
      historyIndex: newIndex,
      activeNotePath: path,
      isDirty: false
    })
  },

  goForward: () => {
    const state = get()
    flushIfDirty(state)
    if (state.historyIndex >= state.historyStack.length - 1) return
    const newIndex = state.historyIndex + 1
    const path = state.historyStack[newIndex]

    set({
      historyIndex: newIndex,
      activeNotePath: path,
      isDirty: false
    })
  }
}))

/** Immediately save current content if dirty via DocumentManager. */
export function flushPendingSave(): Promise<void> {
  const state = useEditorStore.getState()
  return persistDirtyDocument(state, { markSavedOnSuccess: true })
}
