import { useState, useCallback, useMemo, useEffect } from 'react'
import { useVaultWorker } from './engine/useVaultWorker'
import type { WorkerResult } from './engine/types'
import { ThemeProvider } from './design/Theme'
import { SplitPane } from './design/components/SplitPane'
import { Sidebar } from './panels/sidebar/Sidebar'
import { ClaudeConfigSidebar } from './panels/sidebar/ClaudeConfigSidebar'
import { buildFileTree } from './panels/sidebar/buildFileTree'
import { EditorPanel } from './panels/editor/EditorPanel'
import { SkillsPanel } from './panels/skills/SkillsPanel'
import { CanvasView } from './panels/canvas/CanvasView'
import { ClaudeConfigPanel } from './panels/claude-config/ClaudeConfigPanel'
import { ProjectCanvasPanel } from './panels/project-canvas/ProjectCanvasPanel'
import { GraphPanel } from './panels/graph/GraphPanel'
import { ActivityBar } from './components/ActivityBar'
import { useTabStore, TAB_DEFINITIONS } from './store/tab-store'
import type { TabType } from './store/tab-store'
import { TerminalPanel } from './panels/terminal/TerminalPanel'
import { WelcomeScreen } from './panels/onboarding/WelcomeScreen'
import { CommandPalette, type CommandItem } from './design/components/CommandPalette'
import { useKeyboard } from './hooks/useKeyboard'
import { useCanvasFilePaths, useCanvasConnectionCounts } from './hooks/useCanvasAwareness'
import { useVaultStore } from './store/vault-store'
import { useEditorStore, flushPendingSave } from './store/editor-store'
import { useViewStore } from './store/view-store'
import { colors } from './design/tokens'
import { SettingsModal } from './components/SettingsModal'
import { PanelErrorBoundary } from './components/PanelErrorBoundary'
import { GoogleFontLoader } from './components/GoogleFontLoader'
import type { ArtifactType } from '@shared/types'
import { useCanvasStore } from './store/canvas-store'
import { saveCanvas, defaultCanvasFilename } from './panels/canvas/canvas-io'
import { createCanvasFile } from '@shared/canvas-types'

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

function ContentArea() {
  const activeTabId = useTabStore((s) => s.activeTabId)
  const tabs = useTabStore((s) => s.tabs)
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const activeType = activeTab?.type ?? 'editor'
  const setActiveNote = useEditorStore((s) => s.setActiveNote)

  // Track which panel types have been opened (ever) so they stay mounted
  const openTypes = useMemo(() => new Set(tabs.map((t) => t.type)), [tabs])

  const handleNavigate = useCallback(
    (id: string) => {
      setActiveNote(id, null)
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
      {openTypes.has('canvas') && (
        <KeepAliveSlot active={activeType === 'canvas'}>
          <CanvasView />
        </KeepAliveSlot>
      )}
      {openTypes.has('skills') && (
        <KeepAliveSlot active={activeType === 'skills'}>
          <SkillsPanel />
        </KeepAliveSlot>
      )}
      {openTypes.has('claude-config') && (
        <KeepAliveSlot active={activeType === 'claude-config'}>
          <ClaudeConfigPanel />
        </KeepAliveSlot>
      )}
      {openTypes.has('project-canvas') && (
        <KeepAliveSlot active={activeType === 'project-canvas'}>
          <ProjectCanvasPanel />
        </KeepAliveSlot>
      )}
      {openTypes.has('graph') && (
        <KeepAliveSlot active={activeType === 'graph'}>
          <GraphPanel />
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
  const contentView = useViewStore((s) => s.contentView)
  const sidebarOpenTab = useTabStore((s) => s.openTab)
  const files = useVaultStore((s) => s.files)
  const config = useVaultStore((s) => s.config)
  const activeWorkspace = useVaultStore((s) => s.activeWorkspace)
  const setActiveWorkspace = useVaultStore((s) => s.setActiveWorkspace)
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const artifacts = useVaultStore((s) => s.artifacts)
  const fileToId = useVaultStore((s) => s.fileToId)
  const activeNotePath = useEditorStore((s) => s.activeNotePath)
  const setContentView = useViewStore((s) => s.setContentView)
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
          const parentNode = allTreeNodes.find((n) => n.path === parent)
          parent = parentNode?.parentPath
        }
      }
    }
    return allTreeNodes.filter((n) => matchingFiles.has(n.path) || requiredDirs.has(n.path))
  }, [allTreeNodes, searchQuery])

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

  const openTab = useEditorStore((s) => s.openTab)

  const handleFileSelect = useCallback(
    (path: string) => {
      // When on a canvas view, single-clicks should not navigate away.
      // The user must double-click to open in editor (double-click also fires this).
      const view = useViewStore.getState().contentView
      if (view === 'canvas' || view === 'project-canvas') return

      const file = files.find((f) => f.path === path)
      openTab(path, file?.title)
      setContentView('editor')
    },
    [files, openTab, setContentView]
  )

  const handleFileDoubleClick = useCallback(
    (path: string) => {
      const file = files.find((f) => f.path === path)
      openTab(path, file?.title)
      setContentView('editor')
    },
    [files, openTab, setContentView]
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
    openTab(filePath, title)
    setContentView('editor')
  }, [vaultPath, files, openTab, setContentView])

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
      // If we're on the claude-config view, switch back to editor
      if (useViewStore.getState().contentView === 'claude-config') {
        setContentView('editor')
      }
    },
    [onLoadVault, setContentView]
  )

  const handleSelectClaudeConfig = useCallback(() => {
    const def = TAB_DEFINITIONS['claude-config']
    sidebarOpenTab({
      id: 'claude-config',
      type: 'claude-config',
      label: def.label,
      closeable: true
    })
  }, [sidebarOpenTab])

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
          openTab(filePath, title)
          setContentView('editor')
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
    [files, openTab, setContentView]
  )

  // Show claude config sidebar when on that view
  if (contentView === 'claude-config') {
    return (
      <ClaudeConfigSidebar
        vaultHistory={vaultHistory}
        onSelectVault={handleSelectVault}
        onOpenVaultPicker={handleOpenVaultPicker}
        onSelectClaudeConfig={handleSelectClaudeConfig}
        onRemoveFromHistory={handleRemoveFromHistory}
      />
    )
  }

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
      onSearch={setSearchQuery}
      onWorkspaceSelect={setActiveWorkspace}
      onFileSelect={handleFileSelect}
      onFileDoubleClick={handleFileDoubleClick}
      onToggleDirectory={handleToggleDirectory}
      onNewFile={handleNewFile}
      onSortChange={setSortMode}
      onFileAction={handleFileAction}
      onSelectVault={handleSelectVault}
      onSelectClaudeConfig={handleSelectClaudeConfig}
      onOpenVaultPicker={handleOpenVaultPicker}
      onRemoveFromHistory={handleRemoveFromHistory}
      onOpenSettings={onOpenSettings}
    />
  )
}

const BUILT_IN_COMMANDS: CommandItem[] = [
  { id: 'cmd:new-note', label: 'New Note', category: 'command', shortcut: '\u2318N' },
  { id: 'cmd:toggle-view', label: 'Cycle View', category: 'command', shortcut: '\u2318G' },
  { id: 'cmd:toggle-sidebar', label: 'Toggle Sidebar', category: 'command', shortcut: '\u2318B' },
  { id: 'cmd:toggle-terminal', label: 'Toggle Terminal', category: 'command', shortcut: '\u2318`' },
  {
    id: 'cmd:toggle-mode',
    label: 'Toggle Source/Rich Mode',
    category: 'command',
    shortcut: '\u2318/'
  },
  { id: 'cmd:open-settings', label: 'Open Settings', category: 'command' },
  { id: 'cmd:reindex-vault', label: 'Re-index Vault', category: 'command' },
  { id: 'cmd:activate-claude', label: 'Activate Claude', category: 'command' },
  { id: 'cmd:new-canvas', label: 'New Canvas', category: 'command' },
  {
    id: 'cmd:toggle-claude-config',
    label: 'Toggle Claude Config Canvas',
    category: 'command',
    shortcut: '\u21E7\u2318C'
  },
  {
    id: 'cmd:toggle-project-canvas',
    label: 'Toggle Project Canvas',
    category: 'command',
    shortcut: '\u21E7\u2318P'
  }
]

function WorkspaceShell({ onLoadVault }: { onLoadVault: (path: string) => Promise<void> }) {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showTerminal, setShowTerminal] = useState(false)
  const files = useVaultStore((s) => s.files)
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const contentView = useViewStore((s) => s.contentView)
  const setContentView = useViewStore((s) => s.setContentView)
  const mode = useEditorStore((s) => s.mode)
  const setMode = useEditorStore((s) => s.setMode)
  const openTab = useTabStore((s) => s.openTab)
  const closeTab = useTabStore((s) => s.closeTab)
  const activeTabId = useTabStore((s) => s.activeTabId)

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

  const toggleTerminal = useCallback(() => {
    setShowTerminal((prev) => !prev)
  }, [])

  const goBack = useEditorStore((s) => s.goBack)
  const goForward = useEditorStore((s) => s.goForward)

  useKeyboard({
    onCommandPalette: () => setPaletteOpen(true),
    onCycleView: toggleView,
    onToggleSourceMode: toggleSourceMode,
    onToggleTerminal: toggleTerminal,
    onCloseTab: handleCloseTab,
    onGoBack: goBack,
    onGoForward: goForward,
    onEscape: () => setPaletteOpen(false)
  })

  // Cmd+Shift+C: toggle Claude Config Canvas tab
  // Cmd+Shift+P: toggle Project Canvas tab
  // Cmd+Shift+G: toggle Graph tab
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        toggleTabView('claude-config')
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        toggleTabView('project-canvas')
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault()
        toggleTabView('graph')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [toggleTabView])

  const paletteItems = useMemo<CommandItem[]>(() => {
    const noteItems: CommandItem[] = files.map((f) => ({
      id: `note:${f.path}`,
      label: f.title,
      category: 'note',
      folderPath: f.path.split('/').slice(0, -1).join('/')
    }))
    return [...noteItems, ...BUILT_IN_COMMANDS]
  }, [files])

  const handlePaletteSelect = useCallback(
    async (item: CommandItem) => {
      if (item.id.startsWith('note:')) {
        const path = item.id.slice(5)
        const { openTab: storeOpenTab } = useEditorStore.getState()
        storeOpenTab(path)
        setContentView('editor')
        return
      }

      switch (item.id) {
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
        case 'cmd:reindex-vault':
          // TODO: trigger vault re-index
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
        case 'cmd:toggle-claude-config':
          toggleTabView('claude-config')
          break
        case 'cmd:toggle-project-canvas':
          toggleTabView('project-canvas')
          break
      }
    },
    [
      setContentView,
      toggleView,
      toggleSourceMode,
      toggleTerminal,
      setSettingsOpen,
      vaultPath,
      toggleTabView
    ]
  )

  return (
    <div
      className="h-screen w-screen relative flex"
      style={{ backgroundColor: colors.bg.base, color: colors.text.primary }}
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
      <ActivityBar />
      <SplitPane
        left={
          <div className="panel-card h-full pt-7">
            <PanelErrorBoundary name="Sidebar">
              <ConnectedSidebar
                onLoadVault={onLoadVault}
                onOpenSettings={() => setSettingsOpen(true)}
              />
            </PanelErrorBoundary>
          </div>
        }
        right={
          showTerminal ? (
            <SplitPane
              left={
                <PanelErrorBoundary name="Content">
                  <ContentArea />
                </PanelErrorBoundary>
              }
              right={
                <div className="panel-card h-full">
                  <PanelErrorBoundary name="Terminal">
                    <TerminalPanel />
                  </PanelErrorBoundary>
                </div>
              }
              initialLeftWidth={480}
              minLeftWidth={280}
              minRightWidth={300}
            />
          ) : (
            <PanelErrorBoundary name="Content">
              <ContentArea />
            </PanelErrorBoundary>
          )
        }
        initialLeftWidth={220}
        minLeftWidth={220}
        minRightWidth={showTerminal ? 580 : 280}
      />
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
    const discoveredTypes = [...new Set(result.artifacts.map((a) => a.type))].sort()
    const artifactById = new Map(result.artifacts.map((a) => [a.id, a]))
    const updatedFiles = files.map((f) => {
      if (!f.path.endsWith('.md')) return f
      const id = result.fileToId[f.path]
      const artifact = id ? artifactById.get(id) : undefined
      return artifact ? { ...f, title: artifact.title, modified: artifact.modified } : f
    })
    useVaultStore.setState({
      artifacts: result.artifacts,
      graph: result.graph,
      parseErrors: result.errors,
      fileToId: result.fileToId,
      discoveredTypes,
      files: updatedFiles
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
      const mdPaths = useVaultStore
        .getState()
        .files.filter((f) => f.path.endsWith('.md'))
        .map((f) => f.path)
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
              modified: new Date().toISOString().split('T')[0]
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
    return <WelcomeScreen onVaultSelected={orchestrateLoad} />
  }

  return (
    <ThemeProvider>
      <GoogleFontLoader />
      {renderContent()}
    </ThemeProvider>
  )
}
