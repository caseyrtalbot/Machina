import { create } from 'zustand'
import { isSystemArtifactPath } from '@shared/system-artifacts'
import { logError } from '../utils/error-logger'

type EditorMode = 'rich' | 'source'

export interface Tab {
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

  // Navigation history
  readonly historyStack: readonly string[]
  readonly historyIndex: number

  setActiveNote: (path: string | null) => void
  setMode: (mode: EditorMode) => void
  setContent: (content: string) => void
  loadContent: (content: string) => void
  setDirty: (dirty: boolean) => void
  markSaved: () => void
  setCursorPosition: (line: number, col: number) => void

  openSplit: (path: string) => void
  closeSplit: () => void

  openTab: (path: string, title?: string) => void
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
  historyStack: [],
  historyIndex: -1,

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
      historyStack: history.stack,
      historyIndex: history.index
    })
  },

  closeTab: (path) => {
    const state = get()
    if (state.activeNotePath === path) {
      flushIfDirty(state)
    }
    const tabs = state.openTabs.filter((t) => t.path !== path)

    if (state.activeNotePath === path) {
      const oldIndex = state.openTabs.findIndex((t) => t.path === path)
      const nextTab = tabs[Math.min(oldIndex, tabs.length - 1)] ?? null

      set({
        openTabs: tabs,
        activeNotePath: nextTab?.path ?? null,
        isDirty: false
      })
    } else {
      set({ openTabs: tabs })
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
