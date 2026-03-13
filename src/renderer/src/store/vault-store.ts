import { create } from 'zustand'
import type { Artifact, VaultConfig, VaultState, KnowledgeGraph } from '@shared/types'
import { VaultIndex } from '../engine/indexer'

const ipcRenderer = window.electron.ipcRenderer

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
  index: VaultIndex
  activeWorkspace: string | null
  isLoading: boolean

  setVaultPath: (path: string) => void
  setConfig: (config: VaultConfig) => void
  setState: (state: VaultState) => void
  setFiles: (files: VaultFile[]) => void
  setActiveWorkspace: (workspace: string | null) => void
  loadVault: (vaultPath: string) => Promise<void>
  getGraph: () => KnowledgeGraph
  getArtifact: (id: string) => Artifact | undefined
  search: (query: string) => Artifact[]
}

export const useVaultStore = create<VaultStore>((set, get) => ({
  vaultPath: null,
  config: null,
  state: null,
  files: [],
  index: new VaultIndex(),
  activeWorkspace: null,
  isLoading: false,

  setVaultPath: (path) => set({ vaultPath: path }),
  setConfig: (config) => set({ config }),
  setState: (state) => set({ state }),
  setFiles: (files) => set({ files }),
  setActiveWorkspace: (workspace) => set({ activeWorkspace: workspace }),

  loadVault: async (vaultPath: string) => {
    set({ isLoading: true })
    const index = new VaultIndex()

    try {
      // Read config
      const config: VaultConfig = await ipcRenderer.invoke('vault:read-config', { vaultPath })
      const state: VaultState = await ipcRenderer.invoke('vault:read-state', { vaultPath })

      // List all .md files recursively
      const filePaths: string[] = await ipcRenderer.invoke('fs:list-files-recursive', {
        dir: vaultPath
      })

      // Read and parse each file
      const files: VaultFile[] = []
      for (const filePath of filePaths) {
        const content: string = await ipcRenderer.invoke('fs:read-file', { path: filePath })
        const filename = filePath.split('/').pop() ?? filePath
        index.addFile(filePath, content)

        const id = index.getIdForFile(filePath)
        const artifact = id ? index.getArtifact(id) : undefined

        files.push({
          path: filePath,
          filename,
          title: artifact?.title ?? filename.replace(/\.md$/, ''),
          modified: artifact?.modified ?? new Date().toISOString().split('T')[0]
        })
      }

      set({ vaultPath, config, state, files, index, isLoading: false })
    } catch (err) {
      console.error('Failed to load vault:', err)
      set({ vaultPath, isLoading: false })
    }
  },

  getGraph: () => get().index.getGraph(),
  getArtifact: (id) => get().index.getArtifact(id),
  search: (query) => get().index.search(query)
}))
