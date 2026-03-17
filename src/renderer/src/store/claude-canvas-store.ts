import { create } from 'zustand'
import type { CanvasFile } from '@shared/canvas-types'
import { createCanvasFile } from '@shared/canvas-types'

/**
 * Persistence cache for the Claude Config Canvas.
 * The actual rendering state lives in the main canvas-store via store-swap.
 * This store caches the persisted canvas data so we avoid disk reads
 * on every view switch.
 */
interface ClaudeCanvasStore {
  readonly cachedData: CanvasFile | null
  readonly canvasPath: string
  setCachedData: (data: CanvasFile) => void
  setCanvasPath: (path: string) => void
  getOrDefault: () => CanvasFile
}

export const useClaudeCanvasStore = create<ClaudeCanvasStore>((set, get) => ({
  cachedData: null,
  canvasPath: '',

  setCachedData: (cachedData) => set({ cachedData }),
  setCanvasPath: (canvasPath) => set({ canvasPath }),
  getOrDefault: () => get().cachedData ?? createCanvasFile()
}))
