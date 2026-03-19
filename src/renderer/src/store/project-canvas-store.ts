import { create } from 'zustand'
import type { CanvasFile } from '@shared/canvas-types'
import { createCanvasFile } from '@shared/canvas-types'

/**
 * Persistence cache for the Project Canvas.
 * The actual rendering state lives in the main canvas-store via store-swap.
 * This store caches the persisted canvas data so we avoid re-parsing
 * on every view switch.
 */
interface ProjectCanvasStore {
  readonly cachedData: CanvasFile | null
  readonly canvasPath: string
  readonly projectPath: string | null
  setCachedData: (data: CanvasFile) => void
  setCanvasPath: (path: string) => void
  setProjectPath: (path: string | null) => void
  getOrDefault: () => CanvasFile
}

export const useProjectCanvasStore = create<ProjectCanvasStore>((set, get) => ({
  cachedData: null,
  canvasPath: '',
  projectPath: null,

  setCachedData: (cachedData) => set({ cachedData }),
  setCanvasPath: (canvasPath) => set({ canvasPath }),
  setProjectPath: (projectPath) => set({ projectPath }),
  getOrDefault: () => get().cachedData ?? createCanvasFile()
}))
