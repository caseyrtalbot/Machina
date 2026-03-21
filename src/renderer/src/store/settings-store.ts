import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { ACCENT_COLORS, type ThemeId, type AccentColorId } from '../design/themes'

interface SettingsState {
  readonly theme: ThemeId
  readonly accentColor: AccentColorId
  readonly fontSize: number
  readonly fontFamily: string
  readonly defaultEditorMode: 'rich' | 'source'
  readonly autosaveInterval: number
  readonly spellCheck: boolean
  readonly terminalShell: string
  readonly terminalFontSize: number
  readonly scrollbackLines: number
}

interface SettingsActions {
  setTheme: (value: ThemeId) => void
  setAccentColor: (value: AccentColorId) => void
  setFontSize: (value: number) => void
  setFontFamily: (value: string) => void
  setDefaultEditorMode: (value: 'rich' | 'source') => void
  setAutosaveInterval: (value: number) => void
  setSpellCheck: (value: boolean) => void
  setTerminalShell: (value: string) => void
  setTerminalFontSize: (value: number) => void
  setScrollbackLines: (value: number) => void
}

type SettingsStore = SettingsState & SettingsActions

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      theme: 'midnight',
      accentColor: 'matrix',
      fontSize: 13,
      fontFamily: 'Inter',
      defaultEditorMode: 'rich',
      autosaveInterval: 1500,
      spellCheck: false,
      terminalShell: '',
      terminalFontSize: 13,
      scrollbackLines: 10000,

      setTheme: (value) => set({ theme: value }),
      setAccentColor: (value) => set({ accentColor: value }),
      setFontSize: (value) => set({ fontSize: value }),
      setFontFamily: (value) => set({ fontFamily: value }),
      setDefaultEditorMode: (value) => set({ defaultEditorMode: value }),
      setAutosaveInterval: (value) => set({ autosaveInterval: value }),
      setSpellCheck: (value) => set({ spellCheck: value }),
      setTerminalShell: (value) => set({ terminalShell: value }),
      setTerminalFontSize: (value) => set({ terminalFontSize: value }),
      setScrollbackLines: (value) => set({ scrollbackLines: value })
    }),
    {
      name: 'thought-engine-settings',
      version: 2,
      storage: createJSONStorage(() => localStorage),
      migrate: (persisted) => {
        const state = persisted as Record<string, unknown>
        // Migrate old accent color IDs to new retro neon palette
        const accent = state.accentColor as string | undefined
        if (accent && !(accent in ACCENT_COLORS)) {
          state.accentColor = 'matrix'
        }
        return state as unknown as SettingsState & SettingsActions
      }
    }
  )
)
