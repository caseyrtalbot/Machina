import { lazy, startTransition, Suspense, useState, useCallback, useMemo, useEffect } from 'react'
import { useVaultWorker } from './engine/useVaultWorker'
import type { WorkerResult } from './engine/types'
import { ThemeProvider } from './design/Theme'
import { Sidebar } from './panels/sidebar/Sidebar'
import type { SystemArtifactListItem } from './panels/sidebar/Sidebar'
import { buildFileTree } from './panels/sidebar/buildFileTree'
import { EditorPanel } from './panels/editor/EditorPanel'
import { ActivityBar } from './components/ActivityBar'
import { useTabStore, TAB_DEFINITIONS } from './store/tab-store'
import type { TabType } from './store/tab-store'
import { CommandPalette, type CommandItem } from './design/components/CommandPalette'
import { useKeyboard } from './hooks/useKeyboard'
import { useCanvasFilePaths, useCanvasConnectionCounts } from './hooks/useCanvasAwareness'
import { useVaultStore } from './store/vault-store'
import { useEditorStore, flushPendingSave } from './store/editor-store'
import { useViewStore } from './store/view-store'
import { useWorkbenchActionStore } from './store/workbench-actions-store'
import { colors } from './design/tokens'
import { SettingsModal } from './components/SettingsModal'
import { PanelErrorBoundary } from './components/PanelErrorBoundary'
import { GoogleFontLoader } from './components/GoogleFontLoader'
import type { ArtifactType } from '@shared/types'
import { isSystemArtifactKind } from '@shared/system-artifacts'
import { useCanvasStore } from './store/canvas-store'
import { saveCanvas, defaultCanvasFilename } from './panels/canvas/canvas-io'
import { createCanvasFile } from '@shared/canvas-types'
import { openArtifactInEditor } from './system-artifacts/system-artifact-runtime'
import {
  placeArtifactOnWorkbench,
  enrichPlacedArtifact
} from './panels/workbench/workbench-artifact-placement'
import { useTerminalActionStore } from './store/terminal-actions-store'
import { CanvasFloatingSidebar } from './panels/canvas/CanvasFloatingSidebar'
import { getCanvasNodeTitle } from './panels/canvas/card-title'

const LazyCanvasView = lazy(() =>
  import('./panels/canvas/CanvasView').then((module) => ({ default: module.CanvasView }))
)
const LazySkillsPanel = lazy(() =>
  import('./panels/skills/SkillsPanel').then((module) => ({ default: module.SkillsPanel }))
)

const LazyWorkbenchPanel = lazy(() =>
  import('./panels/workbench/WorkbenchPanel').then((module) => ({
    default: module.WorkbenchPanel
  }))
)
const LazyGraphPanel = lazy(() =>
  import('./panels/graph/GraphPanel').then((module) => ({ default: module.GraphPanel }))
)
const LazyTerminalPanel = lazy(() =>
  import('./panels/terminal/TerminalPanel').then((module) => ({ default: module.TerminalPanel }))
)
const LazyWelcomeScreen = lazy(() =>
  import('./panels/onboarding/WelcomeScreen').then((module) => ({
    default: module.WelcomeScreen
  }))
)

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
      setActiveNote(id, path)
    },
    [setActiveNote]
  )

  return (
    <div className="h-full overflow-hidden">
      {openTypes.has('editor') && (
        <KeepAliveSlot active={activeType === 'editor'}>
          <EditorPanel onNavigate={handleNavigate} />
        </KeepAliveSlot>
      )}
      {openTypes.has('canvas') && mountedTypes.has('canvas') && (
        <KeepAliveSlot active={activeType === 'canvas'}>
          <Suspense fallback={<PanelLoadingFallback label="Loading vault canvas..." />}>
            <LazyCanvasView />
          </Suspense>
        </KeepAliveSlot>
      )}
      {openTypes.has('skills') && mountedTypes.has('skills') && (
        <KeepAliveSlot active={activeType === 'skills'}>
          <Suspense fallback={<PanelLoadingFallback label="Loading skills..." />}>
            <LazySkillsPanel />
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

  // Load vault history on mount
  useEffect(() => {
    window.api.config
      .read('app', 'vaultHistory')
      .then((history) => {
        if (Array.isArray(history)) setVaultHistory(history as string[])
      })
      .catch(() => {})
  }, [])

  const vaultName = vaultPath?.split('/').pop() ?? 'Thought Engine'

  const allTreeNodes = useMemo(() => {
    const paths = files.map((f) => f.path)
    return buildFileTree(paths, vaultPath ?? '')
  }, [files, vaultPath])
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

  const openEditorPath = useCallback(
    (path: string, title?: string) => {
      openArtifactInEditor(path, title, fileToId[path] ?? null)
    },
    [fileToId]
  )

  const handleFileSelect = useCallback(
    (path: string) => {
      // When on a canvas view, single-clicks should not navigate away.
      // The user must double-click to open in editor (double-click also fires this).
      const view = useViewStore.getState().contentView
      if (view === 'canvas' || view === 'workbench') return

      const file = files.find((f) => f.path === path)
      openEditorPath(path, file?.title)
    },
    [files, openEditorPath]
  )

  const handleFileDoubleClick = useCallback(
    (path: string) => {
      const file = files.find((f) => f.path === path)
      openEditorPath(path, file?.title)
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
    openArtifactInEditor(filePath, title)
  }, [vaultPath, files])

  const handleOpenVaultPicker = useCallback(async () => {
    const path = await window.api.fs.selectVault()
    if (!path) return
    flushPendingSave()
    await window.api.vault.watchStop()
    await onLoadVault(path)
  }, [onLoadVault])

  const handleSelectVault = useCallback(
    async (path: string) => {
      flushPendingSave()
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
          openArtifactInEditor(filePath, title)
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
      }
    },
    [files]
  )

  return (
    <Sidebar
      nodes={treeNodes}
      workspaces={config?.workspaces ?? []}
      activeWorkspace={activeWorkspace}
      activeFilePath={activeNotePath}
      collapsedPaths={searchQuery.trim() ? EMPTY_SET : collapsedPaths}
      artifactTypes={artifactTypes}
      onCanvasPaths={onCanvasPaths}
      canvasConnectionCounts={canvasConnectionCounts}
      sortMode={sortMode}
      vaultName={vaultName}
      vaultHistory={vaultHistory}
      systemArtifacts={systemArtifacts}
      onSearch={setSearchQuery}
      onWorkspaceSelect={setActiveWorkspace}
      onFileSelect={handleFileSelect}
      onFileDoubleClick={handleFileDoubleClick}
      onSystemArtifactSelect={(item) => {
        const nodeId = placeArtifactOnWorkbench(item)
        if (nodeId && vaultPath) {
          enrichPlacedArtifact(nodeId, item, vaultPath).catch(() => {})
        }
        openArtifactInEditor(item.path, item.title, item.id)
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
    description: 'Rotate between the editor, vault canvas, and skills tabs.'
  },
  {
    id: 'cmd:toggle-sidebar',
    label: 'Toggle Sidebar',
    category: 'command',
    shortcut: '\u2318B',
    description: 'Show or hide the file browser sidebar.'
  },
  {
    id: 'cmd:toggle-terminal',
    label: 'Toggle Terminal',
    category: 'command',
    shortcut: '\u2318`',
    description: 'Show or hide the integrated terminal split.'
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
  }
]

function WorkspaceShell({ onLoadVault }: { onLoadVault: (path: string) => Promise<void> }) {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showTerminal, setShowTerminal] = useState(false)
  const [showSidebar, setShowSidebar] = useState(true)
  const files = useVaultStore((s) => s.files)
  const systemFiles = useVaultStore((s) => s.systemFiles)
  const artifacts = useVaultStore((s) => s.artifacts)
  const fileToId = useVaultStore((s) => s.fileToId)
  const vaultPath = useVaultStore((s) => s.vaultPath)
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
    else if (contentView === 'canvas') setContentView('skills')
    else if (contentView === 'skills') setContentView('editor')
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
    openArtifactInEditor(path, title)
  }, [files, vaultPath])

  const toggleTerminal = useCallback(() => {
    setShowTerminal((prev) => !prev)
  }, [])

  const toggleSidebar = useCallback(() => {
    setShowSidebar((prev) => !prev)
  }, [])

  const goBack = useEditorStore((s) => s.goBack)
  const goForward = useEditorStore((s) => s.goForward)

  useKeyboard({
    onCommandPalette: () => setPaletteOpen(true),
    onCycleView: toggleView,
    onToggleSourceMode: toggleSourceMode,
    onToggleSidebar: toggleSidebar,
    onToggleTerminal: toggleTerminal,
    onCloseTab: handleCloseTab,
    onGoBack: goBack,
    onGoForward: goForward,
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

  const handlePaletteSelect = useCallback(
    async (item: CommandItem) => {
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
        openArtifactInEditor(path, file?.title, fileToId[path] ?? null)
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
        case 'cmd:toggle-terminal':
          toggleTerminal()
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
        case 'cmd:activate-claude':
          setShowTerminal(true)
          useTerminalActionStore.getState().requestActivateClaude()
          break
        case 'cmd:new-canvas':
          if (vaultPath) {
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
      }
    },
    [
      fileToId,
      paletteFiles,
      setContentView,
      handleNewNote,
      toggleView,
      toggleSourceMode,
      toggleSidebar,
      toggleTerminal,
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
      className="h-screen w-screen relative flex"
      style={
        {
          backgroundColor: colors.bg.base,
          color: colors.text.primary,
          '--sidebar-inset': sidebarExpanded ? '340px' : '120px'
        } as React.CSSProperties
      }
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
      <ActivityBar floating />
      {/* Content + terminal: both always mounted at stable tree positions */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-hidden">
          <PanelErrorBoundary name="Content">
            <ContentArea />
          </PanelErrorBoundary>
        </div>
        {/* Terminal panel: always mounted to preserve PTY sessions, CSS-hidden when collapsed */}
        <div
          className="panel-card h-full overflow-hidden"
          style={{
            width: showTerminal ? 480 : 0,
            minWidth: showTerminal ? 300 : 0,
            transition: 'width 150ms ease-out, min-width 150ms ease-out',
            borderLeft: showTerminal ? `1px solid ${colors.border.default}` : 'none'
          }}
        >
          <PanelErrorBoundary name="Terminal">
            <Suspense fallback={<PanelLoadingFallback label="Loading terminal..." />}>
              <LazyTerminalPanel />
            </Suspense>
          </PanelErrorBoundary>
        </div>
      </div>
      {/* Floating sidebar: always visible, collapsed or expanded */}
      <CanvasFloatingSidebar
        collapsed={!sidebarExpanded}
        onToggle={toggleSidebar}
        vaultName={vaultPath?.split('/').pop()}
      >
        <PanelErrorBoundary name="Sidebar">
          <ConnectedSidebar
            onLoadVault={onLoadVault}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </PanelErrorBoundary>
      </CanvasFloatingSidebar>
      <CommandPalette
        isOpen={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={paletteItems}
        onSelect={handlePaletteSelect}
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
  const vaultPath = useVaultStore((s) => s.vaultPath)
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

  const { loadFiles, updateFile, removeFile } = useVaultWorker(onWorkerResult)

  const orchestrateLoad = useCallback(
    async (path: string) => {
      await window.api.vault.init(path)
      await loadVault(path)
      const state = useVaultStore.getState().state
      if (state) {
        if (state.contentView) {
          const view = state.contentView as string
          if (view === 'editor' || view === 'canvas' || view === 'skills') {
            useViewStore.getState().setContentView(view)
          }
        }
        if (state.lastOpenNote)
          useEditorStore.getState().setActiveNote(state.lastOpenNote, state.lastOpenNote)
      }
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
      const filesWithContent = await Promise.all(
        mdPaths.map(async (p) => ({ path: p, content: await window.api.fs.readFile(p) }))
      )
      loadFiles(filesWithContent)
    },
    [loadVault, loadFiles]
  )

  useEffect(() => {
    window.api.config
      .read('app', 'lastVaultPath')
      .then((savedPath) => {
        if (typeof savedPath === 'string' && savedPath) orchestrateLoad(savedPath)
      })
      .catch(() => {})
  }, [orchestrateLoad])

  useEffect(() => {
    window.addEventListener('beforeunload', flushPendingSave)
    return () => window.removeEventListener('beforeunload', flushPendingSave)
  }, [])

  useEffect(() => {
    const unsub = window.api.on.filesChangedBatch(async (data) => {
      // Process all events in one pass using a Map to avoid state accumulation race
      const currentFiles = useVaultStore.getState().files
      const fileMap = new Map(currentFiles.map((f) => [f.path, f]))
      const mdToUpdate: string[] = []
      const mdToRemove: string[] = []

      for (const { path, event } of data.events) {
        const isMd = path.endsWith('.md')

        if (event === 'unlink') {
          fileMap.delete(path)
          if (isMd) mdToRemove.push(path)
        } else if (event === 'add') {
          if (!fileMap.has(path)) {
            const filename = path.split('/').pop() ?? path
            const dotIdx = filename.lastIndexOf('.')
            const title = dotIdx > 0 ? filename.slice(0, dotIdx) : filename
            fileMap.set(path, {
              path,
              filename,
              title,
              modified: new Date().toISOString().split('T')[0],
              source: 'vault'
            })
          }
          if (isMd) mdToUpdate.push(path)
        } else {
          if (isMd) mdToUpdate.push(path)
        }
      }

      // Single state update for all file list changes
      setFiles(Array.from(fileMap.values()))

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
    if (vaultPath) return <WorkspaceShell onLoadVault={orchestrateLoad} />
    return (
      <Suspense fallback={<LoadingSkeleton />}>
        <LazyWelcomeScreen onVaultSelected={orchestrateLoad} />
      </Suspense>
    )
  }

  return (
    <ThemeProvider>
      <GoogleFontLoader />
      {renderContent()}
    </ThemeProvider>
  )
}
