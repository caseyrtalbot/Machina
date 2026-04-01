import { create } from 'zustand'
import type {
  Artifact,
  FilesystemFileEntry,
  VaultConfig,
  VaultState,
  KnowledgeGraph
} from '@shared/types'
import type { ParseError, WorkerResult } from '@engine/types'

interface VaultFile {
  readonly path: string
  readonly filename: string
  readonly title: string
  readonly modified: string
  readonly source: 'vault' | 'system'
}

function toVaultFile(entry: FilesystemFileEntry, source: 'vault' | 'system'): VaultFile {
  const filename = entry.path.split('/').pop() ?? entry.path
  const dotIdx = filename.lastIndexOf('.')
  const title = dotIdx > 0 ? filename.slice(0, dotIdx) : filename
  return {
    path: entry.path,
    filename,
    title,
    modified: entry.mtime ?? '',
    source
  }
}

interface VaultStore {
  readonly vaultPath: string | null
  readonly config: VaultConfig | null
  readonly state: VaultState | null
  readonly files: readonly VaultFile[]
  readonly systemFiles: readonly VaultFile[]
  readonly artifacts: readonly Artifact[]
  readonly graph: KnowledgeGraph
  readonly parseErrors: readonly ParseError[]
  readonly fileToId: Readonly<Record<string, string>>
  readonly artifactPathById: Readonly<Record<string, string>>
  readonly artifactById: Readonly<Record<string, Artifact>>
  readonly edgeCountByArtifactId: Readonly<Record<string, number>>
  readonly rawFileCount: number
  readonly discoveredTypes: readonly string[]
  readonly activeWorkspace: string | null
  readonly isLoading: boolean

  setVaultPath: (path: string) => void
  setConfig: (config: VaultConfig) => void
  setState: (state: VaultState) => void
  setFiles: (files: VaultFile[]) => void
  setSystemFiles: (files: VaultFile[]) => void
  setActiveWorkspace: (workspace: string | null) => void
  loadVault: (vaultPath: string) => Promise<void>
  setWorkerResult: (result: WorkerResult) => void
  getBacklinks: (targetId: string) => Artifact[]
}

export const useVaultStore = create<VaultStore>((set, get) => ({
  vaultPath: null,
  config: null,
  state: null,
  files: [],
  systemFiles: [],
  artifacts: [],
  graph: { nodes: [], edges: [] },
  parseErrors: [],
  fileToId: {},
  artifactPathById: {},
  artifactById: {},
  edgeCountByArtifactId: {},
  rawFileCount: 0,
  discoveredTypes: [],
  activeWorkspace: null,
  isLoading: false,

  setVaultPath: (path) => set({ vaultPath: path }),
  setConfig: (config) => set({ config }),
  setState: (state) => set({ state }),
  setFiles: (files) => set({ files }),
  setSystemFiles: (systemFiles) => set({ systemFiles }),
  setActiveWorkspace: (workspace) => set({ activeWorkspace: workspace }),

  loadVault: async (vaultPath: string) => {
    set({ isLoading: true })
    try {
      const [config, state, fileEntries, systemPaths] = await Promise.all([
        window.api.vault.readConfig(vaultPath),
        window.api.vault.readState(vaultPath),
        window.api.fs.listAllFiles(vaultPath),
        window.api.vault.listSystemArtifacts(vaultPath)
      ])
      const files = fileEntries.map((entry) => toVaultFile(entry, 'vault'))
      const systemFiles = systemPaths.map((filePath: string) =>
        toVaultFile({ path: filePath, mtime: '' }, 'system')
      )
      set({ vaultPath, config, state, files, systemFiles, isLoading: false })
    } catch (err) {
      console.error('Failed to load vault:', err)
      set({ vaultPath, isLoading: false })
    }
  },

  setWorkerResult: (result) => {
    const discoveredTypes = [...new Set(result.artifacts.map((a) => a.type))].sort()

    const artifactById: Record<string, Artifact> = {}
    for (const a of result.artifacts) {
      artifactById[a.id] = a
    }

    const edgeCountByArtifactId: Record<string, number> = {}
    for (const e of result.graph.edges) {
      edgeCountByArtifactId[e.source] = (edgeCountByArtifactId[e.source] ?? 0) + 1
      edgeCountByArtifactId[e.target] = (edgeCountByArtifactId[e.target] ?? 0) + 1
    }

    const rawFileCount = result.artifacts.filter(
      (a) =>
        a.connections.length === 0 &&
        a.clusters_with.length === 0 &&
        a.tensions_with.length === 0 &&
        a.related.length === 0 &&
        a.tags.length === 0
    ).length

    set({
      artifacts: result.artifacts,
      graph: result.graph,
      parseErrors: result.errors,
      fileToId: result.fileToId,
      artifactPathById: result.artifactPathById,
      discoveredTypes,
      artifactById,
      edgeCountByArtifactId,
      rawFileCount
    })
  },

  getBacklinks: (targetId: string): Artifact[] => {
    const { graph, artifacts } = get()
    const lowerTarget = targetId.toLowerCase()
    const sourceIds = new Set<string>()
    for (const edge of graph.edges) {
      const edgeTargetLower = edge.target.toLowerCase()
      const edgeSourceLower = edge.source.toLowerCase()
      if (edgeTargetLower === lowerTarget && edgeSourceLower !== lowerTarget) {
        sourceIds.add(edge.source)
      }
      if (
        edgeSourceLower === lowerTarget &&
        edgeTargetLower !== lowerTarget &&
        edge.kind !== 'appears_in'
      ) {
        sourceIds.add(edge.target)
      }
    }
    return artifacts.filter((a) => sourceIds.has(a.id))
  }
}))
