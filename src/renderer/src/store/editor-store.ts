import { create } from 'zustand'

type EditorMode = 'rich' | 'source'

export interface Tab {
  readonly path: string
  readonly title: string
}

interface EditorStore {
  activeNoteId: string | null
  activeNotePath: string | null
  mode: EditorMode
  isDirty: boolean
  content: string
  cursorLine: number
  cursorCol: number

  // Tabs
  openTabs: readonly Tab[]

  // Navigation history
  historyStack: readonly string[]
  historyIndex: number

  setActiveNote: (id: string | null, path: string | null) => void
  setMode: (mode: EditorMode) => void
  setContent: (content: string) => void
  loadContent: (content: string) => void
  setDirty: (dirty: boolean) => void
  markSaved: () => void
  setCursorPosition: (line: number, col: number) => void

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

function pushHistory(
  stack: readonly string[],
  index: number,
  path: string
): { stack: readonly string[]; index: number } {
  const truncated = stack.slice(0, index + 1)
  if (truncated[truncated.length - 1] === path) {
    return { stack: truncated, index }
  }
  return { stack: [...truncated, path], index: truncated.length }
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  activeNoteId: null,
  activeNotePath: null,
  mode: 'rich',
  isDirty: false,
  content: '',
  cursorLine: 1,
  cursorCol: 1,
  openTabs: [],
  historyStack: [],
  historyIndex: -1,

  setActiveNote: (id, path) => {
    if (!path) {
      set({ activeNoteId: null, activeNotePath: null, isDirty: false })
      return
    }

    const state = get()
    const title = titleFromPath(path)
    const tabs = state.openTabs.some((t) => t.path === path)
      ? state.openTabs
      : [...state.openTabs, { path, title }]
    const history = pushHistory(state.historyStack, state.historyIndex, path)

    set({
      activeNoteId: id,
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

  openTab: (path, title) => {
    const state = get()
    // Flush pending save for current file before switching
    if (state.isDirty && state.activeNotePath && state.content) {
      window.api.fs.writeFile(state.activeNotePath, state.content)
    }
    const resolvedTitle = title ?? titleFromPath(path)
    const tabs = state.openTabs.some((t) => t.path === path)
      ? state.openTabs
      : [...state.openTabs, { path, title: resolvedTitle }]
    const history = pushHistory(state.historyStack, state.historyIndex, path)

    set({
      activeNoteId: path,
      activeNotePath: path,
      isDirty: false,
      openTabs: tabs,
      historyStack: history.stack,
      historyIndex: history.index
    })
  },

  closeTab: (path) => {
    const state = get()
    // Flush any pending save for the file being closed
    if (state.activeNotePath === path && state.isDirty && state.content) {
      window.api.fs.writeFile(path, state.content)
    }
    const tabs = state.openTabs.filter((t) => t.path !== path)

    if (state.activeNotePath === path) {
      const oldIndex = state.openTabs.findIndex((t) => t.path === path)
      const nextTab = tabs[Math.min(oldIndex, tabs.length - 1)] ?? null

      set({
        openTabs: tabs,
        activeNoteId: nextTab?.path ?? null,
        activeNotePath: nextTab?.path ?? null,
        isDirty: false
      })
    } else {
      set({ openTabs: tabs })
    }
  },

  switchTab: (path) => {
    const state = get()
    // Flush any pending save for the current file before switching
    if (state.isDirty && state.activeNotePath && state.content) {
      window.api.fs.writeFile(state.activeNotePath, state.content)
    }
    if (state.activeNotePath === path) return
    const history = pushHistory(state.historyStack, state.historyIndex, path)

    set({
      activeNoteId: path,
      activeNotePath: path,
      isDirty: false,
      historyStack: history.stack,
      historyIndex: history.index
    })
  },

  goBack: () => {
    const state = get()
    if (state.historyIndex <= 0) return
    const newIndex = state.historyIndex - 1
    const path = state.historyStack[newIndex]

    set({
      historyIndex: newIndex,
      activeNoteId: path,
      activeNotePath: path,
      isDirty: false
    })
  },

  goForward: () => {
    const state = get()
    if (state.historyIndex >= state.historyStack.length - 1) return
    const newIndex = state.historyIndex + 1
    const path = state.historyStack[newIndex]

    set({
      historyIndex: newIndex,
      activeNoteId: path,
      activeNotePath: path,
      isDirty: false
    })
  }
}))

/** Immediately save current content if dirty. Fire-and-forget for responsiveness. */
export function flushPendingSave(): void {
  const { isDirty, content, activeNotePath } = useEditorStore.getState()
  if (!isDirty || !activeNotePath || !content) return
  window.api.fs.writeFile(activeNotePath, content)
  useEditorStore.getState().markSaved()
}
