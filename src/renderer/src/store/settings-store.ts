import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import {
  ACCENT_COLORS,
  ENV_DEFAULTS,
  type ThemeId,
  type ResolvedThemeId,
  type AccentColorId,
  type EnvironmentSettings
} from '../design/themes'

export function resolveTheme(theme: ThemeId): ResolvedThemeId {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

interface SettingsState {
  readonly theme: ThemeId
  readonly accentColor: AccentColorId
  readonly env: EnvironmentSettings
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
  setEnv: <K extends keyof EnvironmentSettings>(key: K, value: EnvironmentSettings[K]) => void
  resetEnv: () => void
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
    (set, get) => ({
      theme: 'dark',
      accentColor: 'matrix',
      env: { ...ENV_DEFAULTS.dark },
      defaultEditorMode: 'rich',
      autosaveInterval: 1500,
      spellCheck: false,
      terminalShell: '',
      terminalFontSize: 13,
      scrollbackLines: 10000,

      // Resets env to theme defaults on EVERY explicit theme switch,
      // including re-clicking the current theme. This is intentional:
      // it gives users a quick "reset to defaults" path.
      setTheme: (value) => {
        const resolved = resolveTheme(value)
        set({ theme: value, env: { ...ENV_DEFAULTS[resolved] } })
      },
      setAccentColor: (value) => set({ accentColor: value }),
      setEnv: (key, value) => set((state) => ({ env: { ...state.env, [key]: value } })),
      resetEnv: () => {
        const resolved = resolveTheme(get().theme)
        set({ env: { ...ENV_DEFAULTS[resolved] } })
      },
      setDefaultEditorMode: (value) => set({ defaultEditorMode: value }),
      setAutosaveInterval: (value) => set({ autosaveInterval: value }),
      setSpellCheck: (value) => set({ spellCheck: value }),
      setTerminalShell: (value) => set({ terminalShell: value }),
      setTerminalFontSize: (value) => set({ terminalFontSize: value }),
      setScrollbackLines: (value) => set({ scrollbackLines: value })
    }),
    {
      name: 'machina-settings',
      version: 3,
      storage: createJSONStorage(() => localStorage),
      migrate: (persisted, version) => {
        const state = persisted as Record<string, unknown>

        if (version < 3) {
          const oldTheme = state.theme as string
          const isLight = oldTheme === 'light'
          state.theme = isLight ? 'light' : 'dark'

          const defaults = isLight ? ENV_DEFAULTS.light : ENV_DEFAULTS.dark
          const oldFontSize = (state.fontSize as number | undefined) ?? 13
          state.env = { ...defaults, sidebarFontSize: oldFontSize }

          delete state.fontSize
          delete state.fontFamily
        }

        const accent = state.accentColor as string | undefined
        if (accent && !(accent in ACCENT_COLORS)) {
          state.accentColor = 'matrix'
        }

        return state as unknown as SettingsState & SettingsActions
      }
    }
  )
)
