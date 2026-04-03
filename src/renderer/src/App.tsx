import {
  lazy,
  startTransition,
  Suspense,
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef
} from 'react'
import { logError } from './utils/error-logger'
import { withTimeout } from './utils/ipc-timeout'
import { perfMark, perfMeasure } from './utils/perf-marks'
import { chunkArray, readChunk, yieldToEventLoop } from './utils/chunk-loader'
import { useVaultWorker } from './engine/useVaultWorker'
import type { WorkerResult } from './engine/types'
import { ThemeProvider } from './design/Theme'
import { Sidebar } from './panels/sidebar/Sidebar'
import type { SystemArtifactListItem } from './panels/sidebar/Sidebar'
import { buildFileTree } from './panels/sidebar/buildFileTree'
import type { ArtifactOrigin } from './panels/sidebar/origin-utils'
import { useSidebarSelectionStore } from './store/sidebar-selection-store'
import { useAgentStates } from './hooks/use-agent-states'
import { EditorSplitView } from './panels/editor/EditorSplitView'
import { ActivityBar } from './components/ActivityBar'
import { useTabStore, TAB_DEFINITIONS } from './store/tab-store'
import type { TabType } from './store/tab-store'
import { CommandPalette, type CommandItem } from './design/components/CommandPalette'
import { AGENT_ACTIONS, type AgentActionName } from '@shared/agent-action-types'
import { useKeyboard } from './hooks/useKeyboard'
import { useCanvasFilePaths, useCanvasConnectionCounts } from './hooks/useCanvasAwareness'
import { useVaultStore } from './store/vault-store'
import { useEditorStore, flushPendingSave } from './store/editor-store'
import { useViewStore } from './store/view-store'
import { useWorkbenchActionStore } from './store/workbench-actions-store'
import { colors } from './design/tokens'
import { SettingsModal } from './components/SettingsModal'
import { PanelErrorBoundary } from './components/PanelErrorBoundary'
import pLimit from 'p-limit'
import { SearchEngine } from './engine/search-engine'
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
import type { ArtifactType } from '@shared/types'
import { isSystemArtifactKind } from '@shared/system-artifacts'
import { useCanvasStore } from './store/canvas-store'
import { createCanvasFile, createCanvasNode } from '@shared/canvas-types'
import { getCanvasNodeTitle } from './panels/canvas/card-title'

const LazyCanvasView = lazy(() =>
  import('./panels/canvas/CanvasView').then((module) => ({ default: module.CanvasView }))
)

const LazyWorkbenchPanel = lazy(() =>
  import('./panels/workbench/WorkbenchPanel').then((module) => ({
    default: module.WorkbenchPanel
  }))
)
const LazyGraphPanel = lazy(() =>
  import('./panels/graph/GraphViewShell').then((module) => ({ default: module.GraphViewShell }))
)
const LazyGhostPanel = lazy(() =>
  import('./panels/ghosts/GhostPanel').then((module) => ({ default: module.GhostPanel }))
)

async function openArtifactInEditorOnDemand(path: string, title?: string): Promise<void> {
  const { openArtifactInEditor } = await import('./system-artifacts/system-artifact-runtime')
  openArtifactInEditor(path, title)
}

async function placeSystemArtifactOnWorkbench(
  item: SystemArtifactListItem,
  vaultPath: string | null
): Promise<void> {
  const { placeArtifactOnWorkbench, enrichPlacedArtifact } =
    await import('./panels/workbench/workbench-artifact-placement')
  const nodeId = placeArtifactOnWorkbench(item)
  if (nodeId && vaultPath) {
    void enrichPlacedArtifact(nodeId, item, vaultPath).catch((err) =>
      logError('enrich-artifact', err)
    )
  }
}

/** Wrapper that keeps its children mounted but hidden when inactive. */
function KeepAliveSlot({
  active,
  children
}: {
  readonly active: boolean
  readonly children: React.ReactNode
}) {
  return (
    <div className="h-full w-full" style={{ display: active ? 'contents' : 'none' }}>
      {children}
    </div>
  )
}

function PanelLoadingFallback({ label }: { readonly label: string }) {
  return (
    <div
      className="h-full w-full flex items-center justify-center"
      style={{ color: colors.text.muted }}
    >
      <span className="text-sm">{label}</span>
    </div>
  )
}

function ContentArea() {
  const activeTabId = useTabStore((s) => s.activeTabId)
  const tabs = useTabStore((s) => s.tabs)
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const activeType = activeTab?.type ?? 'editor'
  const setActiveNote = useEditorStore((s) => s.setActiveNote)

  const openTypes = useMemo(() => new Set(tabs.map((t) => t.type)), [tabs])
  const [mountedTypes, setMountedTypes] = useState<ReadonlySet<TabType>>(
    () => new Set([activeType])
  )

  useEffect(() => {
    startTransition(() => {
      setMountedTypes((prev) => {
        if (prev.has(activeType)) return prev
        const next = new Set(prev)
        next.add(activeType)
        return next
      })
    })
  }, [activeType])

  const handleNavigate = useCallback(
    (id: string) => {
      // Resolve artifact ID to file path via the vault's fileToId reverse lookup
      const fileToId = useVaultStore.getState().fileToId
      const path = Object.entries(fileToId).find(([, v]) => v === id)?.[0] ?? null
      setActiveNote(path)
    },
    [setActiveNote]
  )

  return (
    <div className="h-full overflow-hidden">
      {openTypes.has('editor') && (
        <KeepAliveSlot active={activeType === 'editor'}>
          <EditorSplitView onNavigate={handleNavigate} />
        </KeepAliveSlot>
      )}
      {openTypes.has('canvas') && mountedTypes.has('canvas') && (
        <KeepAliveSlot active={activeType === 'canvas'}>
          <Suspense fallback={<PanelLoadingFallback label="Loading vault canvas..." />}>
            <LazyCanvasView />
          </Suspense>
        </KeepAliveSlot>
      )}
      {openTypes.has('workbench') && mountedTypes.has('workbench') && (
        <KeepAliveSlot active={activeType === 'workbench'}>
          <Suspense fallback={<PanelLoadingFallback label="Loading workbench..." />}>
            <LazyWorkbenchPanel />
          </Suspense>
        </KeepAliveSlot>
      )}
      {openTypes.has('graph') && mountedTypes.has('graph') && (
        <KeepAliveSlot active={activeType === 'graph'}>
          <Suspense fallback={<PanelLoadingFallback label="Loading graph..." />}>
            <LazyGraphPanel />
          </Suspense>
        </KeepAliveSlot>
      )}
      {openTypes.has('ghosts') && mountedTypes.has('ghosts') && (
        <KeepAliveSlot active={activeType === 'ghosts'}>
          <Suspense fallback={<PanelLoadingFallback label="Loading ghosts..." />}>
            <LazyGhostPanel />
          </Suspense>
        </KeepAliveSlot>
      )}
    </div>
  )
}

const EMPTY_SET = new Set<string>()

function ConnectedSidebar({
  onLoadVault,
  onOpenSettings
}: {
  onLoadVault: (path: string) => Promise<void>
  onOpenSettings?: () => void
}) {
  const files = useVaultStore((s) => s.files)
  const config = useVaultStore((s) => s.config)
  const activeWorkspace = useVaultStore((s) => s.activeWorkspace)
  const setActiveWorkspace = useVaultStore((s) => s.setActiveWorkspace)
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const artifacts = useVaultStore((s) => s.artifacts)
  const fileToId = useVaultStore((s) => s.fileToId)
  const artifactPathById = useVaultStore((s) => s.artifactPathById)
  const activeNotePath = useEditorStore((s) => s.activeNotePath)
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set())
  const [sortMode, setSortMode] = useState<'modified' | 'name' | 'type'>('modified')
  const [searchQuery, setSearchQuery] = useState('')
  const [vaultHistory, setVaultHistory] = useState<string[]>([])

  // Load vault history on mount, auto-prune paths that no longer exist on disk
  useEffect(() => {
    window.api.config
      .read('app', 'vaultHistory')
      .then(async (history) => {
        if (!Array.isArray(history)) return
        const paths = history as string[]
        const checks = await Promise.all(
          paths.map(async (p) => ({ path: p, exists: await window.api.app.pathExists(p) }))
        )
        const valid = checks.filter((c) => c.exists).map((c) => c.path)
        setVaultHistory(valid)
        if (valid.length !== paths.length) {
          window.api.config.write('app', 'vaultHistory', valid)
        }
      })
      .catch((err) => logError('vault-history', err))
  }, [])

  const vaultName = vaultPath?.split('/').pop() ?? 'Machina'

  const artifactTypes = useMemo(() => {
    const artifactById = new Map(artifacts.map((a) => [a.id, a]))
    const map = new Map<string, ArtifactType>()
    for (const [filePath, artifactId] of Object.entries(fileToId)) {
      const artifact = artifactById.get(artifactId)
      if (artifact) {
        map.set(filePath, artifact.type)
      }
    }
    return map
  }, [artifacts, fileToId])

  const artifactOrigins = useMemo(() => {
    const map = new Map<string, ArtifactOrigin>()
    const artifactById = new Map(artifacts.map((a) => [a.id, a]))
    for (const [filePath, artifactId] of Object.entries(fileToId)) {
      const artifact = artifactById.get(artifactId)
      if (artifact) {
        map.set(filePath, artifact.origin)
      }
    }
    return map
  }, [artifacts, fileToId])

  // Snapshot file entries for tree sorting. Only rebuild when files are added/removed
  // or sort mode changes — NOT on mtime-only updates, which cause visible re-ordering
  // ("jerking") during normal navigation.
  const [stableFiles, setStableFiles] = useState(files)
  const prevPathSetRef = useRef('')
  useEffect(() => {
    const pathKey = files.map((f) => f.path).join('\n')
    if (pathKey !== prevPathSetRef.current || sortMode !== 'modified') {
      prevPathSetRef.current = pathKey
      // Intentional: snapshot files only when path set changes, not on mtime updates
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStableFiles(files)
    }
  }, [files, sortMode])

  const allTreeNodes = useMemo(() => {
    return buildFileTree(
      stableFiles.map((file) => ({ path: file.path, modified: file.modified })),
      vaultPath ?? '',
      {
        sortMode,
        getSortType: (path) => {
          const artifactType = artifactTypes.get(path)
          if (artifactType) return artifactType
          const ext = path.split('.').pop()?.toLowerCase()
          return ext && ext !== path ? ext : 'file'
        }
      }
    )
  }, [artifactTypes, stableFiles, sortMode, vaultPath])
  const allTreeNodeByPath = useMemo(
    () => new Map(allTreeNodes.map((node) => [node.path, node])),
    [allTreeNodes]
  )

  const treeNodes = useMemo(() => {
    if (!searchQuery.trim()) return allTreeNodes

    const query = searchQuery.toLowerCase()
    // Find files whose names match the search
    const matchingFiles = new Set(
      allTreeNodes
        .filter((n) => !n.isDirectory && n.name.toLowerCase().includes(query))
        .map((n) => n.path)
    )
    // Collect all ancestor directories needed to display matching files
    const requiredDirs = new Set<string>()
    for (const node of allTreeNodes) {
      if (matchingFiles.has(node.path)) {
        let parent: string | undefined = node.parentPath
        while (parent) {
          if (requiredDirs.has(parent)) break
          requiredDirs.add(parent)
          const parentNode = allTreeNodeByPath.get(parent)
          parent = parentNode?.parentPath
        }
      }
    }
    return allTreeNodes.filter((n) => matchingFiles.has(n.path) || requiredDirs.has(n.path))
  }, [allTreeNodeByPath, allTreeNodes, searchQuery])

  const onCanvasPaths = useCanvasFilePaths()
  const canvasConnectionCounts = useCanvasConnectionCounts(onCanvasPaths)

  const systemArtifacts = useMemo<SystemArtifactListItem[]>(() => {
    const items = artifacts
      .filter(
        (
          artifact
        ): artifact is (typeof artifacts)[number] & { type: 'session' | 'pattern' | 'tension' } =>
          isSystemArtifactKind(artifact.type)
      )
      .map((artifact) => ({
        id: artifact.id,
        path: artifactPathById[artifact.id] ?? '',
        title: artifact.title,
        type: artifact.type,
        modified: artifact.modified,
        status:
          typeof artifact.frontmatter.status === 'string' ? artifact.frontmatter.status : undefined
      }))
      .filter((item) => item.path.length > 0)
      .sort((a, b) => b.modified.localeCompare(a.modified) || a.title.localeCompare(b.title))

    if (!searchQuery.trim()) return items

    const query = searchQuery.trim().toLowerCase()
    return items.filter(
      (item) =>
        item.title.toLowerCase().includes(query) ||
        item.type.toLowerCase().includes(query) ||
        item.status?.toLowerCase().includes(query)
    )
  }, [artifactPathById, artifacts, searchQuery])

  const openEditorPath = useCallback(async (path: string, title?: string) => {
    await openArtifactInEditorOnDemand(path, title)
  }, [])

  const handleFileSelect = useCallback(
    (path: string, e?: React.MouseEvent) => {
      const sel = useSidebarSelectionStore.getState()

      // Cmd-click: toggle file in multi-selection
      if (e?.metaKey) {
        sel.toggle(path)
        return
      }

      // Shift-click: range select from anchor to clicked file
      if (e?.shiftKey) {
        const filePaths = treeNodes.filter((n) => !n.isDirectory).map((n) => n.path)
        sel.selectRange(path, filePaths)
        return
      }

      // Regular click: clear multi-selection, then do existing behavior
      sel.clear()

      // If the file is on the canvas, pan to it (switch to canvas tab if needed)
      const canvasNodes = useCanvasStore.getState().nodes
      const canvasNode = canvasNodes.find(
        (n) => n.metadata?.filePath === path || n.content === path
      )
      if (canvasNode) {
        const view = useViewStore.getState().contentView
        if (view !== 'canvas') {
          useViewStore.getState().setContentView('canvas')
        }
        setTimeout(
          () => {
            useCanvasStore.getState().centerOnNode?.(canvasNode.id)
            useCanvasStore.getState().setSelection(new Set([canvasNode.id]))
            useCanvasStore.getState().setFocusedCard(canvasNode.id)
          },
          view !== 'canvas' ? 100 : 0
        )
        return
      }

      // Single-click only pans canvas; double-click opens in editor
      return
    },
    [files, openEditorPath, treeNodes]
  )

  const handleFileDoubleClick = useCallback(
    (path: string) => {
      const file = files.find((f) => f.path === path)
      void openEditorPath(path, file?.title)
    },
    [files, openEditorPath]
  )

  const handleToggleDirectory = useCallback((path: string) => {
    setCollapsedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  const handleNewFile = useCallback(async () => {
    if (!vaultPath) return

    // Find a unique filename: Untitled.md, Untitled 1.md, Untitled 2.md, ...
    const existingPaths = new Set(files.map((f) => f.path))
    let filename = 'Untitled.md'
    let counter = 1
    while (existingPaths.has(`${vaultPath}/${filename}`)) {
      filename = `Untitled ${counter}.md`
      counter++
    }

    const filePath = `${vaultPath}/${filename}`
    const now = new Date().toISOString().slice(0, 10)
    const title = filename.replace('.md', '')
    const content = `---\nid: ${title}\ntitle: ${title}\ncreated: ${now}\ntags: []\n---\n\n`

    await window.api.fs.writeFile(filePath, content)
    // Select the new file in the editor
    await openArtifactInEditorOnDemand(filePath, title)
  }, [vaultPath, files])

  const handleOpenVaultPicker = useCallback(async () => {
    const path = await window.api.fs.selectVault()
    if (!path) return
    void flushPendingSave()
    useCanvasStore.getState().closeCanvas()
    useViewStore.getState().setContentView('editor')
    await window.api.vault.watchStop()
    await onLoadVault(path)
  }, [onLoadVault])

  const handleSelectVault = useCallback(
    async (path: string) => {
      // Validate path exists before attempting to load (unguarded — no vault yet)
      const exists = await window.api.app.pathExists(path)
      if (!exists) {
        // Auto-remove from history and update state
        const history = (await window.api.config.read('app', 'vaultHistory')) as string[] | null
        const updated = (history ?? []).filter((p) => p !== path)
        await window.api.config.write('app', 'vaultHistory', updated)
        setVaultHistory(updated)
        return
      }
      void flushPendingSave()
      useCanvasStore.getState().closeCanvas()
      useViewStore.getState().setContentView('editor')
      await window.api.vault.watchStop()
      await onLoadVault(path)
    },
    [onLoadVault]
  )

  const handleRemoveFromHistory = useCallback(async (pathToRemove: string) => {
    const history = (await window.api.config.read('app', 'vaultHistory')) as string[] | null
    const updated = (history ?? []).filter((p) => p !== pathToRemove)
    await window.api.config.write('app', 'vaultHistory', updated)
    setVaultHistory(updated)
  }, [])

  const handleFileAction = useCallback(
    async (action: { actionId: string; path: string; isDirectory: boolean }) => {
      switch (action.actionId) {
        case 'new-file': {
          // Create new note inside the right-clicked folder
          const dir = action.path
          const existingPaths = new Set(files.map((f) => f.path))
          let filename = 'Untitled.md'
          let counter = 1
          while (existingPaths.has(`${dir}/${filename}`)) {
            filename = `Untitled ${counter}.md`
            counter++
          }
          const filePath = `${dir}/${filename}`
          const now = new Date().toISOString().slice(0, 10)
          const title = filename.replace('.md', '')
          const content = `---\nid: ${title}\ntitle: ${title}\ncreated: ${now}\ntags: []\n---\n\n`
          await window.api.fs.writeFile(filePath, content)
          await openArtifactInEditorOnDemand(filePath, title)
          break
        }
        case 'copy-path': {
          await navigator.clipboard.writeText(action.path)
          break
        }
        case 'reveal-finder': {
          await window.api.shell.showInFolder(action.path)
          break
        }
        case 'open-default': {
          await window.api.shell.openPath(action.path)
          break
        }
        case 'duplicate': {
          const ext = action.path.lastIndexOf('.')
          const base = ext > 0 ? action.path.slice(0, ext) : action.path
          const extension = ext > 0 ? action.path.slice(ext) : ''
          const destPath = `${base} copy${extension}`
          await window.api.fs.copyFile(action.path, destPath)
          break
        }
        case 'delete': {
          await window.api.shell.trashItem(action.path)
          const { closeTab: storeCloseTab } = useEditorStore.getState()
          storeCloseTab(action.path)
          // Remove from file list immediately so the UI updates
          const current = useVaultStore.getState().files
          useVaultStore.getState().setFiles(current.filter((f) => f.path !== action.path))
          break
        }
        case 'map-to-canvas': {
          useViewStore.getState().setContentView('canvas')
          useCanvasStore.getState().setPendingFolderMap(action.path)
          break
        }
      }
    },
    [files]
  )

  // Ground-truth: any vault agent (librarian/curator) alive?
  const allAgentStates = useAgentStates()
  const vaultAgentAlive = useMemo(
    () =>
      allAgentStates.some(
        (s) => (s.label === 'librarian' || s.label === 'curator') && s.status === 'alive'
      ),
    [allAgentStates]
  )

  return (
    <Sidebar
      nodes={treeNodes}
      workspaces={config?.workspaces ?? []}
      activeWorkspace={activeWorkspace}
      activeFilePath={activeNotePath}
      collapsedPaths={searchQuery.trim() ? EMPTY_SET : collapsedPaths}
      artifactTypes={artifactTypes}
      artifactOrigins={artifactOrigins}
      onCanvasPaths={onCanvasPaths}
      canvasConnectionCounts={canvasConnectionCounts}
      selectedPaths={useSidebarSelectionStore((s) => s.selectedPaths)}
      agentActive={vaultAgentAlive}
      sortMode={sortMode}
      vaultName={vaultName}
      vaultHistory={vaultHistory}
      systemArtifacts={systemArtifacts}
      onSearch={setSearchQuery}
      onWorkspaceSelect={setActiveWorkspace}
      onFileSelect={handleFileSelect}
      onFileDoubleClick={handleFileDoubleClick}
      onSystemArtifactSelect={(item) => {
        void placeSystemArtifactOnWorkbench(item, vaultPath)
        void openArtifactInEditorOnDemand(item.path, item.title)
      }}
      onToggleDirectory={handleToggleDirectory}
      onNewFile={handleNewFile}
      onSortChange={setSortMode}
      onFileAction={handleFileAction}
      onSelectVault={handleSelectVault}
      onOpenVaultPicker={handleOpenVaultPicker}
      onRemoveFromHistory={handleRemoveFromHistory}
      onOpenSettings={onOpenSettings}
    />
  )
}

const BUILT_IN_COMMANDS: CommandItem[] = [
  {
    id: 'cmd:new-note',
    label: 'New Note',
    category: 'command',
    shortcut: '\u2318N',
    description: 'Create a blank markdown note in the current vault.',
    keywords: ['create', 'markdown', 'file']
  },
  {
    id: 'cmd:toggle-view',
    label: 'Cycle Main View',
    category: 'command',
    shortcut: '\u2318G',
    description: 'Rotate between the editor and vault canvas tabs.'
  },
  {
    id: 'cmd:toggle-sidebar',
    label: 'Toggle Sidebar',
    category: 'command',
    shortcut: '\u2318B',
    description: 'Show or hide the file browser sidebar.'
  },
  {
    id: 'cmd:toggle-mode',
    label: 'Toggle Source and Rich Mode',
    category: 'command',
    shortcut: '\u2318/',
    description: 'Switch the editor between markdown source and rich text.'
  },
  {
    id: 'cmd:open-settings',
    label: 'Open Settings',
    category: 'command',
    description: 'Open application settings and vault controls.'
  },
  {
    id: 'cmd:reindex-vault',
    label: 'Re-index Vault',
    category: 'command',
    description: 'Re-parse all vault files and rebuild the knowledge graph.'
  },
  {
    id: 'cmd:new-canvas',
    label: 'New Canvas',
    category: 'command',
    description: 'Create a new freeform vault canvas document.'
  },
  {
    id: 'cmd:activate-claude',
    label: 'Activate Claude',
    category: 'command',
    description: 'Open a terminal with Claude CLI in the current vault.'
  },

  {
    id: 'cmd:toggle-workbench',
    label: 'Toggle Workbench',
    category: 'command',
    shortcut: '\u21E7\u2318P',
    description: 'Open or hide the project workbench.',
    keywords: ['project canvas', 'timeline', 'sessions', 'artifacts']
  },
  {
    id: 'cmd:toggle-graph',
    label: 'Toggle Graph',
    category: 'command',
    shortcut: '\u21E7\u2318G',
    description: 'Open or hide the graph panel.'
  },
  {
    id: 'cmd:map-vault-root',
    label: 'Map Vault Root',
    category: 'command',
    description: 'Analyze vault structure and visualize it on the canvas.',
    keywords: ['folder', 'project', 'map', 'canvas']
  },
  ...AGENT_ACTIONS.map((action) => ({
    id: `cmd:agent-${action.id}`,
    label: action.label,
    category: 'command' as const,
    description: action.description,
    keywords: [...action.keywords, 'agent']
  }))
]

function ResizableSidebar({
  onLoadVault,
  onOpenSettings,
  collapsed
}: {
  onLoadVault: (path: string) => Promise<void>
  onOpenSettings: () => void
  collapsed: boolean
}) {
  const [width, setWidth] = useState(264)
  const [isDragging, setIsDragging] = useState(false)
  const dragging = useRef(false)
  const activityBarWidth = 48

  const handleMouseDown = useCallback(() => {
    dragging.current = true
    setIsDragging(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const newWidth = e.clientX - activityBarWidth
      setWidth(Math.max(200, Math.min(newWidth, 500)))
    }

    const onUp = () => {
      dragging.current = false
      setIsDragging(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  return (
    <>
      <aside
        className="workspace-sidebar-panel h-full flex flex-col shrink-0 overflow-hidden pt-8"
        style={{
          width: collapsed ? 0 : width,
          transition: isDragging ? undefined : 'width 200ms ease-out',
          backgroundColor: 'var(--chrome-rail-bg)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)'
        }}
      >
        <PanelErrorBoundary name="Sidebar">
          <ConnectedSidebar onLoadVault={onLoadVault} onOpenSettings={onOpenSettings} />
        </PanelErrorBoundary>
      </aside>
      <div
        className="panel-divider"
        onMouseDown={collapsed ? undefined : handleMouseDown}
        style={{
          opacity: collapsed ? 0 : 1,
          pointerEvents: collapsed ? 'none' : undefined,
          transition: 'opacity 200ms ease-out'
        }}
      />
    </>
  )
}

function WorkspaceShell({ onLoadVault }: { onLoadVault: (path: string) => Promise<void> }) {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showSidebar, setShowSidebar] = useState(true)
  const files = useVaultStore((s) => s.files)
  const systemFiles = useVaultStore((s) => s.systemFiles)
  const artifacts = useVaultStore((s) => s.artifacts)
  const fileToId = useVaultStore((s) => s.fileToId)
  const artifactPathById = useVaultStore((s) => s.artifactPathById)
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const searchEngineRef = useRef(new SearchEngine())

  // Sync search engine whenever artifacts change
  useEffect(() => {
    const search = searchEngineRef.current
    search.clear()
    for (const artifact of artifacts) {
      const path = artifactPathById[artifact.id]
      if (path) {
        search.upsert({
          id: artifact.id,
          title: artifact.title,
          tags: artifact.tags,
          body: artifact.body,
          path
        })
      }
    }
  }, [artifacts, artifactPathById])
  const contentView = useViewStore((s) => s.contentView)
  const setContentView = useViewStore((s) => s.setContentView)
  const mode = useEditorStore((s) => s.mode)
  const setMode = useEditorStore((s) => s.setMode)
  const openTab = useTabStore((s) => s.openTab)
  const closeTab = useTabStore((s) => s.closeTab)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const canvasNodeCount = useCanvasStore((s) => s.nodes.length)
  const workbenchRefresh = useWorkbenchActionStore((s) => s.refresh)
  const workbenchFitAll = useWorkbenchActionStore((s) => s.fitAll)
  const workbenchAddTerminal = useWorkbenchActionStore((s) => s.addTerminal)
  const workbenchCreateTension = useWorkbenchActionStore((s) => s.createTension)
  const workbenchSavePattern = useWorkbenchActionStore((s) => s.savePattern)
  const workbenchEndSession = useWorkbenchActionStore((s) => s.endSession)
  const workbenchToggleThread = useWorkbenchActionStore((s) => s.toggleThread)
  const selectedNodeCount = useWorkbenchActionStore((s) => s.selectedNodeCount)
  const milestoneCount = useWorkbenchActionStore((s) => s.milestoneCount)
  const workbenchThreadOpen = useWorkbenchActionStore((s) => s.threadOpen)
  const workbenchIsLive = useWorkbenchActionStore((s) => s.isLive)

  // All views use floating chrome for a seamless infinite canvas aesthetic
  const sidebarExpanded = showSidebar

  const toggleTabView = useCallback(
    (type: TabType) => {
      const def = TAB_DEFINITIONS[type]
      if (activeTabId === type) {
        closeTab(type)
      } else {
        openTab({ id: type, type, label: def.label, closeable: type !== 'editor' })
      }
    },
    [activeTabId, openTab, closeTab]
  )

  const toggleView = useCallback(() => {
    if (contentView === 'editor') setContentView('canvas')
    else if (contentView === 'canvas') setContentView('editor')
    else setContentView('editor')
  }, [contentView, setContentView])

  const toggleSourceMode = useCallback(() => {
    setMode(mode === 'rich' ? 'source' : 'rich')
  }, [mode, setMode])

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

  const handleCloseTab = useCallback(() => {
    const { activeNotePath: path, closeTab: storeCloseTab } = useEditorStore.getState()
    if (path) storeCloseTab(path)
  }, [])

  const handleNewNote = useCallback(async () => {
    if (!vaultPath) return

    const existingPaths = new Set(files.map((file) => file.path))
    let filename = 'Untitled.md'
    let counter = 1
    while (existingPaths.has(`${vaultPath}/${filename}`)) {
      filename = `Untitled ${counter}.md`
      counter++
    }

    const path = `${vaultPath}/${filename}`
    const title = filename.replace('.md', '')
    const now = new Date().toISOString().slice(0, 10)
    const content = `---\nid: ${title}\ntitle: ${title}\ncreated: ${now}\ntags: []\n---\n\n`

    await window.api.fs.writeFile(path, content)
    await openArtifactInEditorOnDemand(path, title)
  }, [files, vaultPath])

  const toggleSidebar = useCallback(() => {
    setShowSidebar((prev) => !prev)
  }, [])

  const goBack = useEditorStore((s) => s.goBack)
  const goForward = useEditorStore((s) => s.goForward)

  const handleSplitEditor = useCallback(() => {
    const { splitNotePath, closeSplit, openSplit, activeNotePath } = useEditorStore.getState()
    if (splitNotePath) {
      closeSplit()
    } else if (activeNotePath) {
      // Open split with the same file; user can navigate the split pane independently
      openSplit(activeNotePath)
    }
  }, [])

  useKeyboard({
    onCommandPalette: () => setPaletteOpen(true),
    onCycleView: toggleView,
    onToggleSourceMode: toggleSourceMode,
    onToggleSidebar: toggleSidebar,
    onCloseTab: handleCloseTab,
    onGoBack: goBack,
    onGoForward: goForward,
    onSplitEditor: handleSplitEditor,
    onEscape: () => setPaletteOpen(false)
  })

  // Cmd+Shift+P: toggle Workbench tab
  // Cmd+Shift+G: toggle Graph tab
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        toggleTabView('workbench')
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault()
        toggleTabView('graph')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [toggleTabView])

  const artifactById = useMemo(
    () => new Map(artifacts.map((artifact) => [artifact.id, artifact])),
    [artifacts]
  )
  const paletteFiles = useMemo(() => [...files, ...systemFiles], [files, systemFiles])

  const paletteItems = useMemo<CommandItem[]>(() => {
    const noteItems: CommandItem[] = paletteFiles.map((file) => {
      const artifactId = fileToId[file.path]
      const artifact = artifactId ? artifactById.get(artifactId) : undefined
      const relativePath =
        vaultPath && file.path.startsWith(`${vaultPath}/`)
          ? file.path.slice(vaultPath.length + 1)
          : file.path
      const directory = relativePath.includes('/')
        ? relativePath.split('/').slice(0, -1).join('/')
        : undefined
      const status =
        artifact && typeof artifact.frontmatter.status === 'string'
          ? artifact.frontmatter.status
          : undefined

      return {
        id: `note:${file.path}`,
        label: file.title,
        category: 'note',
        description: relativePath,
        folderPath: directory,
        artifactType: artifact?.type,
        keywords: [file.filename, relativePath, artifact?.type, status].filter(
          (value): value is string => Boolean(value)
        )
      }
    })

    const workbenchCommands: CommandItem[] = [
      {
        id: 'cmd:workbench-refresh',
        label: 'Refresh Workbench',
        category: 'command',
        description: workbenchRefresh
          ? 'Re-parse Claude sessions and rebuild the workbench layout.'
          : 'Open the workbench tab to enable refresh.',
        keywords: ['project canvas', 'rebuild', 'sessions'],
        disabled: workbenchRefresh == null
      },
      {
        id: 'cmd:workbench-fit-all',
        label: 'Fit Workbench to View',
        category: 'command',
        description: workbenchFitAll
          ? 'Fit every workbench card into the current viewport.'
          : 'Open the workbench tab to enable viewport actions.',
        keywords: ['project canvas', 'zoom', 'viewport'],
        disabled: workbenchFitAll == null
      },
      {
        id: 'cmd:workbench-add-terminal',
        label: 'Add Workbench Terminal',
        category: 'command',
        description: workbenchAddTerminal
          ? 'Add another terminal card to the active workbench.'
          : 'Open the workbench tab to add terminal cards.',
        keywords: ['terminal', 'project canvas', 'shell'],
        disabled: workbenchAddTerminal == null
      },
      {
        id: 'cmd:workbench-capture-tension',
        label: 'Capture Workbench Tension',
        category: 'command',
        description: workbenchCreateTension
          ? 'Capture the current investigation as a tension artifact.'
          : 'Open the workbench tab to capture tensions.',
        keywords: ['tension', 'artifact', 'investigation', 'project canvas'],
        disabled: workbenchCreateTension == null
      },
      {
        id: 'cmd:workbench-save-pattern',
        label: 'Save Selection as Pattern',
        category: 'command',
        description:
          workbenchSavePattern && selectedNodeCount > 0
            ? `Promote ${selectedNodeCount} selected workbench card${selectedNodeCount === 1 ? '' : 's'} into a reusable pattern artifact.`
            : 'Select workbench cards to enable pattern capture.',
        keywords: ['pattern', 'artifact', 'selection', 'project canvas'],
        disabled: workbenchSavePattern == null || selectedNodeCount === 0
      },
      {
        id: 'cmd:workbench-end-session',
        label: 'End Workbench Session',
        category: 'command',
        description:
          workbenchEndSession && milestoneCount > 0
            ? `Capture the current workbench thread with ${milestoneCount} milestone${milestoneCount === 1 ? '' : 's'}.`
            : 'Start or reopen a live workbench thread to end a session.',
        keywords: ['session', 'artifact', 'project canvas', 'thread'],
        disabled: workbenchEndSession == null || milestoneCount === 0
      },
      {
        id: 'cmd:workbench-toggle-thread',
        label: workbenchThreadOpen ? 'Hide Workbench Thread' : 'Show Workbench Thread',
        category: 'command',
        description: workbenchToggleThread
          ? workbenchIsLive
            ? 'Toggle the live workbench thread while Claude activity is streaming.'
            : 'Toggle the workbench thread history panel.'
          : 'Open the workbench tab to inspect the thread.',
        keywords: ['thread', 'live', 'project canvas', 'timeline'],
        disabled: workbenchToggleThread == null
      }
    ]

    const canvasNodes = useCanvasStore.getState().nodes
    const cardItems: CommandItem[] = canvasNodes.map((node) => ({
      id: `card:${node.id}`,
      label: getCanvasNodeTitle(node, artifacts, fileToId),
      category: 'card' as const,
      description: node.type
    }))

    return [...BUILT_IN_COMMANDS, ...workbenchCommands, ...cardItems, ...noteItems]
    // eslint-disable-next-line react-hooks/exhaustive-deps -- canvasNodeCount is an invalidation signal for getState().nodes snapshot
  }, [
    artifacts,
    artifactById,
    canvasNodeCount,
    fileToId,
    milestoneCount,
    paletteFiles,
    selectedNodeCount,
    vaultPath,
    workbenchAddTerminal,
    workbenchCreateTension,
    workbenchEndSession,
    workbenchFitAll,
    workbenchIsLive,
    workbenchRefresh,
    workbenchSavePattern,
    workbenchThreadOpen,
    workbenchToggleThread
  ])

  const handlePaletteSearch = useCallback((query: string): CommandItem[] => {
    const hits = searchEngineRef.current.search(query)
    return hits.map((hit) => ({
      id: `note:${hit.path}`,
      label: hit.title,
      category: 'search' as const,
      description: hit.snippet,
      folderPath: hit.path,
      artifactType: undefined,
      keywords: [hit.path]
    }))
  }, [])

  const handlePaletteSelect = useCallback(
    async (item: CommandItem) => {
      // Agent actions — dispatch to canvas orchestrator via custom event
      if (item.id.startsWith('cmd:agent-')) {
        const actionName = item.id.replace('cmd:agent-', '') as AgentActionName
        window.dispatchEvent(
          new CustomEvent('agent-action-trigger', { detail: { action: actionName } })
        )
        setPaletteOpen(false)
        return
      }

      if (item.id.startsWith('card:')) {
        const nodeId = item.id.slice(5)
        setContentView('canvas')
        setTimeout(() => {
          useCanvasStore.getState().centerOnNode?.(nodeId)
        }, 100)
        return
      }

      if (item.id.startsWith('note:')) {
        const path = item.id.slice(5)
        const file = paletteFiles.find((entry) => entry.path === path)
        await openArtifactInEditorOnDemand(path, file?.title)
        return
      }

      switch (item.id) {
        case 'cmd:new-note':
          await handleNewNote()
          break
        case 'cmd:toggle-view':
          toggleView()
          break
        case 'cmd:toggle-mode':
          toggleSourceMode()
          break
        case 'cmd:open-settings':
          setSettingsOpen(true)
          break
        case 'cmd:toggle-sidebar':
          toggleSidebar()
          break
        case 'cmd:reindex-vault':
          if (vaultPath) await onLoadVault(vaultPath)
          break
        case 'cmd:activate-claude': {
          if (!vaultPath) break
          // Ensure CLAUDE.md exists
          const claudeMdPath = `${vaultPath}/CLAUDE.md`
          const exists = await window.api.fs.fileExists(claudeMdPath)
          if (!exists) {
            const vaultName = vaultPath.split('/').pop() ?? 'Vault'
            const { generateClaudeMd } = await import('./engine/claude-md-template')
            await window.api.fs.writeFile(claudeMdPath, generateClaudeMd(vaultName))
          }
          // Switch to canvas and spawn Claude terminal card
          setContentView('canvas')
          const vp = useCanvasStore.getState().viewport
          const node = createCanvasNode(
            'terminal',
            { x: -vp.x + 200, y: -vp.y + 100 },
            { metadata: { initialCommand: 'claude' } }
          )
          useCanvasStore.getState().addNode(node)
          break
        }
        case 'cmd:new-canvas':
          if (vaultPath) {
            const { defaultCanvasFilename, saveCanvas } = await import('./panels/canvas/canvas-io')
            const filename = defaultCanvasFilename([])
            const canvasPath = `${vaultPath}/${filename}`
            const data = createCanvasFile()
            await saveCanvas(canvasPath, data)
            useCanvasStore.getState().loadCanvas(canvasPath, data)
            setContentView('canvas')
          }
          break
        case 'cmd:toggle-workbench':
          toggleTabView('workbench')
          break
        case 'cmd:toggle-graph':
          toggleTabView('graph')
          break
        case 'cmd:workbench-refresh':
          if (workbenchRefresh) await workbenchRefresh()
          break
        case 'cmd:workbench-fit-all':
          if (workbenchFitAll) await workbenchFitAll()
          break
        case 'cmd:workbench-add-terminal':
          if (workbenchAddTerminal) await workbenchAddTerminal()
          break
        case 'cmd:workbench-capture-tension':
          if (workbenchCreateTension) await workbenchCreateTension()
          break
        case 'cmd:workbench-save-pattern':
          if (workbenchSavePattern) await workbenchSavePattern()
          break
        case 'cmd:workbench-end-session':
          if (workbenchEndSession) await workbenchEndSession()
          break
        case 'cmd:workbench-toggle-thread':
          if (workbenchToggleThread) await workbenchToggleThread()
          break
        case 'cmd:map-vault-root':
          if (vaultPath) {
            setContentView('canvas')
            useCanvasStore.getState().setPendingFolderMap(vaultPath)
          }
          break
      }
    },
    [
      paletteFiles,
      setContentView,
      handleNewNote,
      toggleView,
      toggleSourceMode,
      toggleSidebar,
      setSettingsOpen,
      vaultPath,
      onLoadVault,
      toggleTabView,
      workbenchAddTerminal,
      workbenchCreateTension,
      workbenchEndSession,
      workbenchFitAll,
      workbenchRefresh,
      workbenchSavePattern,
      workbenchToggleThread
    ]
  )

  return (
    <div
      className="workspace-shell h-screen w-screen relative flex"
      style={{
        backgroundColor: 'transparent',
        color: colors.text.primary
      }}
    >
      {/* Titlebar drag region — transparent overlay for macOS traffic lights */}
      <div
        className="absolute top-0 left-0 right-0 z-50 pointer-events-none"
        style={
          {
            height: 28,
            WebkitAppRegion: 'drag'
          } as React.CSSProperties
        }
      />
      {/* Docked activity bar */}
      <ActivityBar
        onToggleSidebar={toggleSidebar}
        sidebarExpanded={sidebarExpanded}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      {/* Docked sidebar with draggable divider */}
      <ResizableSidebar
        onLoadVault={onLoadVault}
        onOpenSettings={() => setSettingsOpen(true)}
        collapsed={!sidebarExpanded}
      />
      {/* Content area fills remaining space */}
      <div className="flex-1 overflow-hidden">
        <PanelErrorBoundary name="Content">
          <ContentArea />
        </PanelErrorBoundary>
      </div>
      <CommandPalette
        isOpen={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={paletteItems}
        onSelect={handlePaletteSelect}
        onSearch={handlePaletteSearch}
      />
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onChangeVault={handleChangeVault}
      />
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
    const artifactById = new Map(result.artifacts.map((a) => [a.id, a]))

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
        const artifact = id ? artifactById.get(id) : undefined
        return artifact ? { ...entry, title: artifact.title, modified: artifact.modified } : entry
      })

    useVaultStore.setState({
      artifacts: result.artifacts,
      graph: result.graph,
      parseErrors: result.errors,
      fileToId: result.fileToId,
      artifactPathById: result.artifactPathById,
      discoveredTypes,
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
      if (state) {
        if (state.contentView) {
          const view = state.contentView as string
          if (view === 'editor' || view === 'canvas') {
            useViewStore.getState().setContentView(view)
          }
        }
        if (state.lastOpenNote) useEditorStore.getState().setActiveNote(state.lastOpenNote)
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

      // Mark files changed during an active agent run
      const sel = useSidebarSelectionStore.getState()
      if (sel.agentActive) {
        const agentTouched = [...mdToUpdate, ...touchedPaths.filter((p) => !p.endsWith('.md'))]
        if (agentTouched.length > 0) sel.markAgentModified(agentTouched)
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
