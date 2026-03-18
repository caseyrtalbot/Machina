import { create } from 'zustand'

interface InspectorStore {
  readonly inspectorFile: { path: string; title: string } | null
  readonly creationMode: { configType: string } | null
  openInspector: (path: string, title: string) => void
  closeInspector: () => void
  startCreation: (configType: string) => void
  cancelCreation: () => void
}

export const useInspectorStore = create<InspectorStore>((set) => ({
  inspectorFile: null,
  creationMode: null,

  openInspector: (path, title) =>
    set({ inspectorFile: { path, title }, creationMode: null }),

  closeInspector: () =>
    set({ inspectorFile: null, creationMode: null }),

  startCreation: (configType) =>
    set({ creationMode: { configType }, inspectorFile: null }),

  cancelCreation: () =>
    set({ creationMode: null })
}))
