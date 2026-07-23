import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface SettingsState {
  readonly defaultEditorMode: 'rich' | 'source'
  readonly autosaveInterval: number
  readonly spellCheck: boolean
  readonly edgeBrightness: number
  readonly nodeBrightness: number
  // Templates
  readonly templateFolder: string
  // Daily notes
  readonly dailyNoteFolder: string
  readonly dailyNoteTemplate: string
  // Canvas text-card save destination
  readonly canvasTextSaveFolder: string
  /** Opt-in local semantic search (3.11). Off = no model download, no
   * embeddings IPC. Enabling triggers a one-time ~25 MB model download. */
  readonly semanticSearch: boolean
}

interface SettingsActions {
  setDefaultEditorMode: (value: 'rich' | 'source') => void
  setAutosaveInterval: (value: number) => void
  setSpellCheck: (value: boolean) => void
  setEdgeBrightness: (value: number) => void
  setNodeBrightness: (value: number) => void
  setTemplateFolder: (value: string) => void
  setDailyNoteFolder: (value: string) => void
  setDailyNoteTemplate: (value: string) => void
  setCanvasTextSaveFolder: (value: string) => void
  setSemanticSearch: (value: boolean) => void
}

type SettingsStore = SettingsState & SettingsActions

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      defaultEditorMode: 'rich',
      autosaveInterval: 1500,
      spellCheck: false,
      edgeBrightness: 1.0,
      nodeBrightness: 1.0,
      templateFolder: 'templates',
      dailyNoteFolder: 'daily',
      dailyNoteTemplate: '',
      canvasTextSaveFolder: 'Inbox',
      semanticSearch: false,

      setDefaultEditorMode: (value) => set({ defaultEditorMode: value }),
      setAutosaveInterval: (value) => set({ autosaveInterval: value }),
      setSpellCheck: (value) => set({ spellCheck: value }),
      setEdgeBrightness: (value) => set({ edgeBrightness: value }),
      setNodeBrightness: (value) => set({ nodeBrightness: value }),
      setTemplateFolder: (value) => set({ templateFolder: value }),
      setDailyNoteFolder: (value) => set({ dailyNoteFolder: value }),
      setDailyNoteTemplate: (value) => set({ dailyNoteTemplate: value }),
      setCanvasTextSaveFolder: (value) => set({ canvasTextSaveFolder: value }),
      setSemanticSearch: (value) => set({ semanticSearch: value })
    }),
    {
      name: 'machina-settings',
      version: 15,
      storage: createJSONStorage(() => localStorage),
      migrate: (persisted, version) => {
        const state = persisted as Record<string, unknown>

        if (version < 5) {
          // v4 → v5: add graph brightness defaults
          if (typeof state.edgeBrightness !== 'number') state.edgeBrightness = 1.0
          if (typeof state.nodeBrightness !== 'number') state.nodeBrightness = 1.0
        }

        if (version < 7) {
          // v6 → v7: add template and daily note settings
          if (typeof state.templateFolder !== 'string') state.templateFolder = 'templates'
          if (typeof state.dailyNoteFolder !== 'string') state.dailyNoteFolder = 'daily'
          if (typeof state.dailyNoteTemplate !== 'string') state.dailyNoteTemplate = ''
        }

        if (version < 13) {
          // v12 → v13: opt-in local semantic search (3.11), off by default.
          if (typeof state.semanticSearch !== 'boolean') state.semanticSearch = false
        }

        if (version < 14) {
          // v13 → v14: appearance axes deleted (ADR 0005) — the env object,
          // accent picker, and their persisted keys are dead. Drop them.
          delete state.env
          delete state.accentId
          delete state.customAccentHex
        }

        if (version < 15) {
          // v14 → v15: font pickers deleted (ADR 0005) — display/body/mono are
          // now ratified constants in :root, not preferences. Drop the keys.
          delete state.displayFont
          delete state.bodyFont
          delete state.monoFont
        }

        return state as unknown as SettingsState & SettingsActions
      }
    }
  )
)
