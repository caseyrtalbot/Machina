import { create } from 'zustand'
import type { ClaudeConfig } from '@shared/claude-config-types'

interface ClaudeConfigStore {
  readonly config: ClaudeConfig | null
  readonly configPath: string
  readonly isLoading: boolean
  readonly lastLoadedAt: number | null
  setConfig: (config: ClaudeConfig) => void
  setConfigPath: (path: string) => void
  setLoading: (loading: boolean) => void
  reset: () => void
}

export const useClaudeConfigStore = create<ClaudeConfigStore>((set) => ({
  config: null,
  configPath: '',
  isLoading: false,
  lastLoadedAt: null,

  setConfig: (config) => set({ config, isLoading: false, lastLoadedAt: Date.now() }),
  setConfigPath: (configPath) => set({ configPath }),
  setLoading: (isLoading) => set({ isLoading }),
  reset: () => set({ config: null, isLoading: false, lastLoadedAt: null })
}))
