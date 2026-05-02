import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { ENV_DEFAULTS, type EnvironmentSettings } from '../design/themes'
import { DEFAULT_ACCENT_ID } from '../design/accent-presets'

interface SettingsState {
  readonly env: EnvironmentSettings
  readonly displayFont: string
  readonly bodyFont: string
  readonly monoFont: string
  /** Accent preset id from `accent-presets.ts`, or `'custom'` for a hex pick. */
  readonly accentId: string
  /** Hex used when `accentId === 'custom'`. */
  readonly customAccentHex: string
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
}

interface SettingsActions {
  setEnv: <K extends keyof EnvironmentSettings>(key: K, value: EnvironmentSettings[K]) => void
  resetEnv: () => void
  setDisplayFont: (value: string) => void
  setBodyFont: (value: string) => void
  setMonoFont: (value: string) => void
  setAccentId: (value: string) => void
  setCustomAccentHex: (value: string) => void
  setDefaultEditorMode: (value: 'rich' | 'source') => void
  setAutosaveInterval: (value: number) => void
  setSpellCheck: (value: boolean) => void
  setEdgeBrightness: (value: number) => void
  setNodeBrightness: (value: number) => void
  setTemplateFolder: (value: string) => void
  setDailyNoteFolder: (value: string) => void
  setDailyNoteTemplate: (value: string) => void
  setCanvasTextSaveFolder: (value: string) => void
}

type SettingsStore = SettingsState & SettingsActions

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      env: { ...ENV_DEFAULTS },
      displayFont: 'Manrope',
      bodyFont: 'Manrope',
      monoFont: 'Space Mono',
      accentId: DEFAULT_ACCENT_ID,
      customAccentHex: '#ff8c5a',
      defaultEditorMode: 'rich',
      autosaveInterval: 1500,
      spellCheck: false,
      edgeBrightness: 1.0,
      nodeBrightness: 1.0,
      templateFolder: 'templates',
      dailyNoteFolder: 'daily',
      dailyNoteTemplate: '',
      canvasTextSaveFolder: 'Inbox',

      setEnv: (key, value) => set((state) => ({ env: { ...state.env, [key]: value } })),
      resetEnv: () => set({ env: { ...ENV_DEFAULTS } }),
      setDisplayFont: (value) => set({ displayFont: value }),
      setBodyFont: (value) => set({ bodyFont: value }),
      setMonoFont: (value) => set({ monoFont: value }),
      setAccentId: (value) => set({ accentId: value }),
      setCustomAccentHex: (value) => set({ customAccentHex: value }),
      setDefaultEditorMode: (value) => set({ defaultEditorMode: value }),
      setAutosaveInterval: (value) => set({ autosaveInterval: value }),
      setSpellCheck: (value) => set({ spellCheck: value }),
      setEdgeBrightness: (value) => set({ edgeBrightness: value }),
      setNodeBrightness: (value) => set({ nodeBrightness: value }),
      setTemplateFolder: (value) => set({ templateFolder: value }),
      setDailyNoteFolder: (value) => set({ dailyNoteFolder: value }),
      setDailyNoteTemplate: (value) => set({ dailyNoteTemplate: value }),
      setCanvasTextSaveFolder: (value) => set({ canvasTextSaveFolder: value })
    }),
    {
      name: 'machina-settings',
      version: 9,
      storage: createJSONStorage(() => localStorage),
      migrate: (persisted, version) => {
        const state = persisted as Record<string, unknown>

        if (version < 3) {
          // v2 → v3: migrate old fontSize/fontFamily into env, always dark
          const oldFontSize = (state.fontSize as number | undefined) ?? 13
          state.env = { ...ENV_DEFAULTS, sidebarFontSize: oldFontSize }
          delete state.fontSize
          delete state.fontFamily
        }

        if (version < 4) {
          // v3 → v4: strip removed fields, reset env to dark defaults
          delete state.theme
          delete state.accentColor
          delete state.terminalShell
          delete state.terminalFontSize
          delete state.scrollbackLines

          // Preserve user's env tuning if it exists, otherwise use defaults
          const existingEnv = state.env as Record<string, unknown> | undefined
          if (existingEnv) {
            // Keep valid env values, fill missing with defaults
            const defaults = ENV_DEFAULTS as unknown as Record<string, unknown>
            for (const key of Object.keys(defaults)) {
              if (!(key in existingEnv) || typeof existingEnv[key] !== 'number') {
                existingEnv[key] = defaults[key]
              }
            }
          } else {
            state.env = { ...ENV_DEFAULTS }
          }
        }

        if (version < 5) {
          // v4 → v5: add graph brightness defaults
          if (typeof state.edgeBrightness !== 'number') state.edgeBrightness = 1.0
          if (typeof state.nodeBrightness !== 'number') state.nodeBrightness = 1.0
        }

        if (version < 6) {
          // v5 → v6: add card body font size default
          const existingEnv = state.env as Record<string, unknown> | undefined
          if (existingEnv && typeof existingEnv.cardBodyFontSize !== 'number') {
            existingEnv.cardBodyFontSize = 16
          }
        }

        if (version < 7) {
          // v6 → v7: add template and daily note settings
          if (typeof state.templateFolder !== 'string') state.templateFolder = 'templates'
          if (typeof state.dailyNoteFolder !== 'string') state.dailyNoteFolder = 'daily'
          if (typeof state.dailyNoteTemplate !== 'string') state.dailyNoteTemplate = ''
        }

        if (version < 8) {
          // v7 → v8: remove dead env fields no longer used by the live theme model
          const existingEnv = state.env as Record<string, unknown> | undefined
          if (existingEnv) {
            delete existingEnv.panelLightness
          }
        }

        if (version < 9) {
          // v8 → v9: introduce accent picker (Console-direction palette).
          if (typeof state.accentId !== 'string') state.accentId = DEFAULT_ACCENT_ID
          if (typeof state.customAccentHex !== 'string') state.customAccentHex = '#ff8c5a'
        }

        return state as unknown as SettingsState & SettingsActions
      }
    }
  )
)
