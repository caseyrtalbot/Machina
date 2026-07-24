import { useState, useCallback, useEffect, useRef } from 'react'
import { Spinner } from './components/emptystate/Spinner'
import { logError, notifyError, setErrorNotifier } from './utils/error-logger'
import { withTimeout } from './utils/ipc-timeout'
import { isSystemArtifactPath } from '@shared/system-artifacts'
import { perfMark, perfMeasure } from './utils/perf-marks'
import {
  chunkArray,
  yieldToEventLoop,
  setIndexingProgress,
  clearIndexingProgress
} from './utils/chunk-loader'
import { useVaultWorker } from './engine/useVaultWorker'
import type { WorkerResult } from './engine/types'
import { ThemeProvider } from './design/Theme'
import { useSidebarSelectionStore } from './store/sidebar-selection-store'
import { AgentShell } from './panels/agent-shell/AgentShell'
import { useVaultStore } from './store/vault-store'
import type { VaultIndexDelta } from '@shared/index-delta'
import { useEditorStore, flushPendingSave } from './store/editor-store'
import { SettingsModal } from './components/SettingsModal'
import { OnboardingOverlay } from './components/OnboardingOverlay'
import { PanelErrorBoundary } from './components/PanelErrorBoundary'
import { ToastHost, showToast } from './components/Toast'
import { FirstRunScreen, checkSavedVault } from './components/FirstRunScreen'
import { useClaudeStatusStore } from './store/claude-status-store'
import { vaultEvents } from './engine/vault-event-hub'
import {
  rehydrateUiState,
  flushVaultState,
  subscribeVaultPersist,
  registerQuitHandler
} from './store/vault-persist'
import { rehydrateUiStore } from './store/ui-store'
import { useAgentPlanListener } from './hooks/use-agent-plan-listener'
import type { Artifact } from '@shared/types'

function WorkspaceShell({ onLoadVault }: { onLoadVault: (path: string) => Promise<void> }) {
  const [settingsOpen, setSettingsOpen] = useState(false)

  const handleChangeVault = useCallback(async () => {
    try {
      const path = await window.api.fs.selectVault()
      if (path) {
        setSettingsOpen(false)
        await onLoadVault(path)
      }
    } catch (err) {
      logError('change-vault', err)
    }
  }, [onLoadVault])

  // Listen for vault-open requests from the canvas welcome card
  useEffect(() => {
    const handler = (e: Event) => {
      const path = (e as CustomEvent<string>).detail
      if (path) onLoadVault(path).catch((err) => logError('open-vault', err))
    }
    window.addEventListener('te:open-vault', handler)
    return () => window.removeEventListener('te:open-vault', handler)
  }, [onLoadVault])

  // Listen for settings-open requests (e.g. the AUTH error action in threads)
  useEffect(() => {
    const handler = () => setSettingsOpen(true)
    window.addEventListener('te:open-settings', handler)
    return () => window.removeEventListener('te:open-settings', handler)
  }, [])

  return (
    <div className="workspace-shell">
      <div className="te-workspace-shell__main">
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
    <div className="te-vault-loading">
      <div className="te-vault-loading__inner">
        <Spinner size={32} />
        <p className="te-vault-loading__label">Loading vault...</p>
      </div>
    </div>
  )
}

export default function App() {
  const isLoading = useVaultStore((s) => s.isLoading)
  const loadVault = useVaultStore((s) => s.loadVault)
  const setFiles = useVaultStore((s) => s.setFiles)
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const loadError = useVaultStore((s) => s.loadError)
  const [booting, setBooting] = useState(true)
  const [firstRunNotice, setFirstRunNotice] = useState<string | null>(null)

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

  const { loadEntries, appendEntries, applyDelta } = useVaultWorker(onWorkerResult)

  // Renderer index is a projection of main's parse authority. Deltas arrive on
  // a lifetime subscription (below); while a snapshot is hydrating we buffer
  // them here and flush after the snapshot lands, so nothing emitted mid-load
  // is lost and duplicate/late deltas are harmless (upserts replace by path).
  const hydratingRef = useRef(true)
  const deltaBufferRef = useRef<VaultIndexDelta[]>([])

  const orchestrateLoad = useCallback(
    async (requestedPath: string) => {
      perfMark('vault-load-start')
      // workspace:open returns the canonicalized root (symlinks resolved,
      // NFC); use it everywhere so renderer keys match watcher event paths.
      const { root: path } = await window.api.workspace.open(requestedPath)
      await loadVault(path)
      const state = useVaultStore.getState().state
      if (state?.openTabs && state.openTabs.length > 0) {
        // Restore the editor note-tab set, dropping notes deleted since the
        // last session (mirrors the dock's named-canvas validation).
        const exists = await Promise.all(state.openTabs.map((p) => window.api.fs.fileExists(p)))
        useEditorStore.getState().restoreTabs(state.openTabs.filter((_, i) => exists[i]))
      }
      if (state?.lastOpenNote) {
        useEditorStore.getState().setActiveNote(state.lastOpenNote)
      }
      rehydrateUiState()
      rehydrateUiStore()
      window.api.config.write('app', 'lastWorkspacePath', path)

      // Persist workspace history (most-recent-first, deduped, capped at 10)
      const history = (await window.api.config.read('app', 'workspaceHistory')) as string[] | null
      const updated = [path, ...(history ?? []).filter((p) => p !== path)].slice(0, 10)
      await window.api.config.write('app', 'workspaceHistory', updated)

      await window.api.vault.watchStart(path)

      // Hydrate the worker from main's index snapshot (parsed entries, no
      // renderer-side markdown parsing). Buffer any deltas that fire while we
      // chunk the snapshot in, then flush them and switch to live apply.
      hydratingRef.current = true
      deltaBufferRef.current = []
      try {
        const { entries } = await withTimeout(
          window.api.vault.indexSnapshot(),
          30_000,
          'vault:index-snapshot'
        )

        // Progressive hydration: feed entries in chunks so the UI becomes
        // interactive after the first batch instead of blocking on all of them.
        const chunks = chunkArray(entries)
        setIndexingProgress(0, entries.length)
        try {
          // First chunk: load synchronously so the UI has content to show.
          loadEntries(chunks[0] ?? [])
          perfMeasure('vault-load', 'vault-load-start')
          let indexed = chunks[0]?.length ?? 0
          setIndexingProgress(indexed, entries.length)

          // Remaining chunks: append in background, yielding between each so the
          // event loop can process user interactions and paint frames.
          for (let i = 1; i < chunks.length; i++) {
            await yieldToEventLoop(16) // ~1 frame of breathing room
            appendEntries(chunks[i])
            indexed += chunks[i].length
            setIndexingProgress(indexed, entries.length)
          }
        } finally {
          clearIndexingProgress()
        }
      } finally {
        // Always go live again: a failed snapshot fetch must not strand
        // hydratingRef at true, or every future delta buffers forever.
        const buffered = deltaBufferRef.current
        deltaBufferRef.current = []
        hydratingRef.current = false
        for (const delta of buffered) applyDelta(delta.upserts, delta.removes)
      }
    },
    [appendEntries, loadVault, loadEntries, applyDelta]
  )

  // Wire notifyError into the toast stack so DATA-path failures (canvas save,
  // workspace persist, autosave) reach the user instead of only the console.
  useEffect(() => {
    setErrorNotifier(showToast)
  }, [])

  // Claude status boot hook: seed the store once and keep it live. The native
  // key state must land before the first setStatus so the onboarding overlay's
  // suppress gate works from launch, not only after Settings is opened.
  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined
    void (async () => {
      try {
        const hasKey = await window.api.agentNative.hasKey()
        if (!cancelled) useClaudeStatusStore.getState().setNativeKeyConfigured(hasKey)
      } catch (err) {
        logError('native-key-check', err)
      }
      if (cancelled) return
      unsubscribe = window.api.on.claudeStatusChanged((status) =>
        useClaudeStatusStore.getState().setStatus(status)
      )
      try {
        const status = await window.api.claude.getStatus()
        if (!cancelled) useClaudeStatusStore.getState().setStatus(status)
      } catch (err) {
        logError('claude-status-seed', err)
      }
    })()
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        // checkSavedVault verifies the path still exists before loading; a
        // missing workspace clears lastWorkspacePath and shows first-run
        // instead of letting workspace:open mkdir a ghost workspace.
        const check = await checkSavedVault()
        if (check.kind === 'load') {
          await orchestrateLoad(check.path)
        } else if (check.missingPath) {
          setFirstRunNotice(`Previous vault not found at ${check.missingPath}`)
        }
      } catch (err) {
        logError('load-last-vault', err)
      } finally {
        setBooting(false)
      }
    })()
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

  // Single app-level subscription: the listener scans the store registry, so
  // mounting it per CanvasView applied each accepted agent plan once per open
  // canvas tab — the duplicate add/remove failed live re-validation and raised
  // a spurious "changes were rejected" toast.
  useAgentPlanListener()

  useEffect(() => {
    return registerQuitHandler()
  }, [])

  // Live projection: main re-parses each watcher batch and emits a parsed
  // delta. Buffer while a snapshot is hydrating (orchestrateLoad flushes the
  // buffer); otherwise apply straight to the worker.
  useEffect(() => {
    const unsub = window.api.on.indexDelta((delta) => {
      if (hydratingRef.current) {
        deltaBufferRef.current.push(delta)
      } else {
        applyDelta(delta.upserts, delta.removes)
      }
    })
    return unsub
  }, [applyDelta])

  // Sidebar file list + agent-modified marking off the raw watcher batch. This
  // covers every file (not just indexed .md), so it stays even though artifact
  // parsing now flows through the index-delta subscription above.
  useEffect(() => {
    const unsub = vaultEvents.subscribeBatch(async (events) => {
      // Process all events in one pass using a Map to avoid state accumulation race
      const vaultState = useVaultStore.getState()
      const fileMap = new Map(vaultState.files.map((f) => [f.path, f]))
      // The watcher now fires for system artifacts too (index authority); keep
      // them out of the regular files list — they live in systemFiles.
      const systemFileMap = new Map(vaultState.systemFiles.map((f) => [f.path, f]))
      const touchedPaths = [
        ...new Set(events.filter((entry) => entry.event !== 'unlink').map((entry) => entry.path))
      ]
      const mtimes = new Map(
        await Promise.all(
          touchedPaths.map(
            async (path) => [path, (await window.api.fs.fileMtime(path)) ?? ''] as const
          )
        )
      )

      let systemTouched = false
      for (const { path, event } of events) {
        const modified = mtimes.get(path) ?? ''
        const isSystem = isSystemArtifactPath(path)
        systemTouched ||= isSystem
        const targetMap = isSystem ? systemFileMap : fileMap

        if (event === 'unlink') {
          targetMap.delete(path)
        } else if (event === 'add') {
          const existing = targetMap.get(path)
          const filename = path.split('/').pop() ?? path
          const dotIdx = filename.lastIndexOf('.')
          const title = existing?.title ?? (dotIdx > 0 ? filename.slice(0, dotIdx) : filename)
          targetMap.set(path, {
            path,
            filename,
            title,
            modified,
            source: existing?.source ?? 'vault'
          })
        } else {
          const existing = targetMap.get(path)
          if (existing) {
            targetMap.set(path, { ...existing, modified })
          }
        }
      }

      // Single state update for all file list changes
      setFiles(Array.from(fileMap.values()))
      if (systemTouched) {
        useVaultStore.getState().setSystemFiles(Array.from(systemFileMap.values()))
      }

      // Mark files changed during an active agent run (with action label for icon coloring)
      const sel = useSidebarSelectionStore.getState()
      if (sel.agentActive && touchedPaths.length > 0) {
        sel.markAgentModified(touchedPaths, sel.activeAgentLabel ?? undefined)
      }
    })
    return unsub
  }, [setFiles])

  const handleOpenFolder = useCallback(async () => {
    try {
      const path = await window.api.fs.selectVault()
      if (path) {
        setFirstRunNotice(null)
        await orchestrateLoad(path)
      }
    } catch (err) {
      notifyError('open-vault', err, 'Failed to open vault')
    }
  }, [orchestrateLoad])

  const handleOpenHistoryPath = useCallback(
    async (path: string) => {
      try {
        if (!(await window.api.app.pathExists(path))) {
          setFirstRunNotice(`Vault not found at ${path}`)
          return
        }
        setFirstRunNotice(null)
        await orchestrateLoad(path)
      } catch (err) {
        notifyError('open-vault', err, 'Failed to open vault')
      }
    },
    [orchestrateLoad]
  )

  function renderContent() {
    if (booting || isLoading) return <LoadingSkeleton />
    if (!vaultPath) {
      return (
        <FirstRunScreen
          notice={loadError ?? firstRunNotice}
          onOpenFolder={() => void handleOpenFolder()}
          onOpenPath={(path) => void handleOpenHistoryPath(path)}
        />
      )
    }
    return <WorkspaceShell onLoadVault={orchestrateLoad} />
  }

  return (
    <ThemeProvider>
      {renderContent()}
      <ToastHost />
    </ThemeProvider>
  )
}
