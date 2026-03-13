import { create } from 'zustand'

type EditorMode = 'rich' | 'source'

interface EditorStore {
  activeNoteId: string | null
  activeNotePath: string | null
  mode: EditorMode
  isDirty: boolean
  content: string
  cursorLine: number
  cursorCol: number

  setActiveNote: (id: string | null, path: string | null) => void
  setMode: (mode: EditorMode) => void
  setContent: (content: string) => void
  setDirty: (dirty: boolean) => void
  setCursorPosition: (line: number, col: number) => void
}

export const useEditorStore = create<EditorStore>((set) => ({
  activeNoteId: null,
  activeNotePath: null,
  mode: 'rich',
  isDirty: false,
  content: '',
  cursorLine: 1,
  cursorCol: 1,

  setActiveNote: (id, path) => set({ activeNoteId: id, activeNotePath: path, isDirty: false }),
  setMode: (mode) => set({ mode }),
  setContent: (content) => set({ content, isDirty: true }),
  setDirty: (dirty) => set({ isDirty: dirty }),
  setCursorPosition: (line, col) => set({ cursorLine: line, cursorCol: col })
}))
