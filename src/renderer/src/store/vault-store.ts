import { create } from 'zustand'
import type { Artifact, VaultConfig, VaultState, KnowledgeGraph } from '@shared/types'

interface ParseError {
  filename: string
  error: string
}

interface VaultFile {
  path: string
  filename: string
  title: string
  modified: string
}

interface VaultStore {
  vaultPath: string | null
  config: VaultConfig | null
  state: VaultState | null
  files: VaultFile[]
  artifacts: Artifact[]
  graph: KnowledgeGraph
  parseErrors: ParseError[]
  fileToId: Record<string, string>
  activeWorkspace: string | null
  isLoading: boolean

  setVaultPath: (path: string) => void
  setConfig: (config: VaultConfig) => void
  setState: (state: VaultState) => void
  setFiles: (files: VaultFile[]) => void
  setActiveWorkspace: (workspace: string | null) => void
  loadVault: (vaultPath: string) => Promise<void>
  setWorkerResult: (result: {
    artifacts: Artifact[]
    graph: KnowledgeGraph
    errors: ParseError[]
    fileToId: Record<string, string>
  }) => void
  getBacklinks: (targetId: string) => Artifact[]
}

export const useVaultStore = create<VaultStore>((set, get) => ({
  vaultPath: null,
  config: null,
  state: null,
  files: [],
  artifacts: [],
  graph: { nodes: [], edges: [] },
  parseErrors: [],
  fileToId: {},
  activeWorkspace: null,
  isLoading: false,

  setVaultPath: (path) => set({ vaultPath: path }),
  setConfig: (config) => set({ config }),
  setState: (state) => set({ state }),
  setFiles: (files) => set({ files }),
  setActiveWorkspace: (workspace) => set({ activeWorkspace: workspace }),

  loadVault: async (vaultPath: string) => {
    set({ isLoading: true })
    try {
      const config = await window.api.vault.readConfig(vaultPath)
      const state = await window.api.vault.readState(vaultPath)
      const filePaths = await window.api.fs.listFilesRecursive(vaultPath)
      const files: VaultFile[] = filePaths.map((filePath) => {
        const filename = filePath.split('/').pop() ?? filePath
        return {
          path: filePath,
          filename,
          title: filename.replace(/\.md$/, ''),
          modified: new Date().toISOString().split('T')[0]
        }
      })
      set({ vaultPath, config, state, files, isLoading: false })
    } catch (err) {
      console.error('Failed to load vault:', err)
      set({ vaultPath, isLoading: false })
    }
  },

  setWorkerResult: (result) =>
    set({
      artifacts: result.artifacts,
      graph: result.graph,
      parseErrors: result.errors,
      fileToId: result.fileToId
    }),

  getBacklinks: (targetId: string): Artifact[] => {
    const { graph, artifacts } = get()
    const sourceIds = new Set<string>()
    for (const edge of graph.edges) {
      if (edge.target === targetId && edge.source !== targetId) {
        sourceIds.add(edge.source)
      }
      if (edge.source === targetId && edge.target !== targetId && edge.kind !== 'appears_in') {
        sourceIds.add(edge.target)
      }
    }
    return artifacts.filter((a) => sourceIds.has(a.id))
  }
}))
