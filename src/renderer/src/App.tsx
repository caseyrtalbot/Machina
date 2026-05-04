import { useState, useCallback, useEffect } from 'react'
import { logError } from './utils/error-logger'
import { withTimeout } from './utils/ipc-timeout'
import { perfMark, perfMeasure } from './utils/perf-marks'
import { chunkArray, readChunk, yieldToEventLoop } from './utils/chunk-loader'
import { useVaultWorker } from './engine/useVaultWorker'
import type { WorkerResult } from './engine/types'
import { ThemeProvider } from './design/Theme'
import { useSidebarSelectionStore } from './store/sidebar-selection-store'
import { AgentShell } from './panels/agent-shell/AgentShell'
import { useVaultStore } from './store/vault-store'
import { useEditorStore, flushPendingSave } from './store/editor-store'
import { colors } from './design/tokens'
import { SettingsModal } from './components/SettingsModal'
import { OnboardingOverlay } from './components/OnboardingOverlay'
import { PanelErrorBoundary } from './components/PanelErrorBoundary'
import pLimit from 'p-limit'
import { vaultEvents } from './engine/vault-event-hub'
import {
  rehydrateUiState,
  flushVaultState,
  subscribeVaultPersist,
  registerQuitHandler
} from './store/vault-persist'
import { rehydrateUiStore } from './store/ui-store'
import { subscribeCanvasAutosave } from './store/canvas-autosave'
import { GoogleFontLoader } from './components/GoogleFontLoader'
import type { Artifact } from '@shared/types'

function WorkspaceShell({ onLoadVault }: { onLoadVault: (path: string) => Promise<void> }) {
  const [settingsOpen, setSettingsOpen] = useState(false)

  const handleChangeVault = useCallback(async () => {
    const path = await window.api.fs.selectVault()
    if (path) {
      setSettingsOpen(false)
      await onLoadVault(path)
    }
  }, [onLoadVault])

  // Listen for vault-open requests from the canvas welcome card
  useEffect(() => {
    const handler = (e: Event) => {
      const path = (e as CustomEvent<string>).detail
      if (path) void onLoadVault(path)
    }
    window.addEventListener('te:open-vault', handler)
    return () => window.removeEventListener('te:open-vault', handler)
  }, [onLoadVault])

  return (
    <div
      className="workspace-shell h-screen w-screen relative flex"
      style={{
        backgroundColor: 'transparent',
        color: colors.text.primary
      }}
    >
      <div className="flex-1 overflow-hidden">
        <PanelErrorBoundary name="AgentShell">
          <AgentShell
            onOpenSettings={() => setSettingsOpen(true)}
            onChangeVault={handleChangeVault}
          />
        </PanelErrorBoundary>
      </div>
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onChangeVault={handleChangeVault}
      />
      <OnboardingOverlay />
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div
      className="h-screen w-screen flex items-center justify-center"
      style={{ backgroundColor: colors.bg.base }}
    >
      <div className="text-center">
        <div
          className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-4"
          style={{ borderColor: colors.accent.default, borderTopColor: 'transparent' }}
        />
        <p className="text-sm" style={{ color: colors.text.muted }}>
          Loading vault...
        </p>
      </div>
    </div>
  )
}

export default function App() {
  const isLoading = useVaultStore((s) => s.isLoading)
  const loadVault = useVaultStore((s) => s.loadVault)
  const setFiles = useVaultStore((s) => s.setFiles)

  const onWorkerResult = useCallback((result: WorkerResult) => {
    // Merge worker result + file updates into a single Zustand set() to avoid two render cycles
    const files = useVaultStore.getState().files
    const systemFiles = useVaultStore.getState().systemFiles
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

    const updateTitles = <
      T extends {
        readonly path: string
        readonly title: string
        readonly modified: string
      }
    >(
      entries: readonly T[]
    ): T[] =>
      entries.map((entry) => {
        if (!entry.path.endsWith('.md')) return entry
        const id = result.fileToId[entry.path]
        const artifact = id ? artifactById[id] : undefined
        return artifact ? { ...entry, title: artifact.title, modified: artifact.modified } : entry
      })

    useVaultStore.setState({
      artifacts: result.artifacts,
      graph: result.graph,
      parseErrors: result.errors,
      fileToId: result.fileToId,
      artifactPathById: result.artifactPathById,
      discoveredTypes,
      artifactById,
      edgeCountByArtifactId,
      rawFileCount,
      files: updateTitles(files),
      systemFiles: updateTitles(systemFiles)
    })
  }, [])

  const { loadFiles, appendFiles, updateFile, removeFile } = useVaultWorker(onWorkerResult)

  const orchestrateLoad = useCallback(
    async (path: string) => {
      perfMark('vault-load-start')
      await window.api.vault.init(path)
      await loadVault(path)
      const state = useVaultStore.getState().state
      if (state?.lastOpenNote) {
        useEditorStore.getState().setActiveNote(state.lastOpenNote)
      }
      rehydrateUiState()
      rehydrateUiStore()
      window.api.config.write('app', 'lastVaultPath', path)

      // Persist vault history (most-recent-first, deduped, capped at 10)
      const history = (await window.api.config.read('app', 'vaultHistory')) as string[] | null
      const updated = [path, ...(history ?? []).filter((p) => p !== path)].slice(0, 10)
      await window.api.config.write('app', 'vaultHistory', updated)

      await window.api.vault.watchStart(path)
      // Only send .md files to the vault worker (knowledge engine only parses markdown)
      const { files, systemFiles } = useVaultStore.getState()
      const mdPaths = [...files, ...systemFiles]
        .filter((file) => file.path.endsWith('.md'))
        .map((file) => file.path)

      // Progressive hydration: read files in chunks so the UI becomes
      // interactive after the first batch instead of blocking on all files.
      const limit = pLimit(12)
      const reader = (p: string) => withTimeout(window.api.fs.readFile(p), 5000, `readFile ${p}`)
      const chunks = chunkArray(mdPaths)

      // First chunk: load synchronously so the UI has content to show.
      const initialBatch = await readChunk(chunks[0] ?? [], reader, limit)
      loadFiles(initialBatch)
      perfMeasure('vault-load', 'vault-load-start')

      // Remaining chunks: load in background, yielding between each so the
      // event loop can process user interactions and paint frames.
      for (let i = 1; i < chunks.length; i++) {
        await yieldToEventLoop(16) // ~1 frame of breathing room
        const batch = await readChunk(chunks[i], reader, limit)
        appendFiles(batch)
      }
    },
    [appendFiles, loadVault, loadFiles]
  )

  useEffect(() => {
    window.api.config
      .read('app', 'lastVaultPath')
      .then((savedPath) => {
        if (typeof savedPath === 'string' && savedPath) orchestrateLoad(savedPath)
      })
      .catch((err) => logError('load-last-vault', err))
  }, [orchestrateLoad])

  useEffect(() => {
    const handleBeforeUnload = (): void => {
      void flushPendingSave()
      flushVaultState()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  useEffect(() => {
    return subscribeVaultPersist()
  }, [])

  useEffect(() => {
    return subscribeCanvasAutosave()
  }, [])

  useEffect(() => {
    return registerQuitHandler()
  }, [])

  useEffect(() => {
    const unsub = vaultEvents.subscribeBatch(async (events) => {
      const data = { events }
      // Process all events in one pass using a Map to avoid state accumulation race
      const currentFiles = useVaultStore.getState().files
      const fileMap = new Map(currentFiles.map((f) => [f.path, f]))
      const touchedPaths = [
        ...new Set(
          data.events.filter((entry) => entry.event !== 'unlink').map((entry) => entry.path)
        )
      ]
      const mtimes = new Map(
        await Promise.all(
          touchedPaths.map(
            async (path) => [path, (await window.api.fs.fileMtime(path)) ?? ''] as const
          )
        )
      )
      const mdToUpdate: string[] = []
      const mdToRemove: string[] = []

      for (const { path, event } of data.events) {
        const isMd = path.endsWith('.md')
        const modified = mtimes.get(path) ?? ''

        if (event === 'unlink') {
          fileMap.delete(path)
          if (isMd) mdToRemove.push(path)
        } else if (event === 'add') {
          const existing = fileMap.get(path)
          const filename = path.split('/').pop() ?? path
          const dotIdx = filename.lastIndexOf('.')
          const title = existing?.title ?? (dotIdx > 0 ? filename.slice(0, dotIdx) : filename)
          fileMap.set(path, {
            path,
            filename,
            title,
            modified,
            source: existing?.source ?? 'vault'
          })
          if (isMd) mdToUpdate.push(path)
        } else {
          const existing = fileMap.get(path)
          if (existing) {
            fileMap.set(path, { ...existing, modified })
          }
          if (isMd) mdToUpdate.push(path)
        }
      }

      // Single state update for all file list changes
      setFiles(Array.from(fileMap.values()))

      // Mark files changed during an active agent run (with action label for icon coloring)
      const sel = useSidebarSelectionStore.getState()
      if (sel.agentActive) {
        const agentTouched = [...mdToUpdate, ...touchedPaths.filter((p) => !p.endsWith('.md'))]
        if (agentTouched.length > 0) {
          sel.markAgentModified(agentTouched, sel.activeAgentLabel ?? undefined)
        }
      }

      // Batch vault worker updates
      for (const path of mdToRemove) removeFile(path)
      for (const path of mdToUpdate) {
        updateFile(path, await window.api.fs.readFile(path))
      }
    })
    return unsub
  }, [updateFile, removeFile, setFiles])

  function renderContent() {
    if (isLoading) return <LoadingSkeleton />
    return <WorkspaceShell onLoadVault={orchestrateLoad} />
  }

  return (
    <ThemeProvider>
      <GoogleFontLoader />
      {renderContent()}
    </ThemeProvider>
  )
}
