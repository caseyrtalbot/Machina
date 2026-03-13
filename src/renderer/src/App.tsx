import { useState, useCallback, useMemo, useEffect } from 'react'
import { useVaultWorker } from './engine/useVaultWorker'
import { ThemeProvider } from './design/Theme'
import { SplitPane } from './design/components/SplitPane'
import { Sidebar } from './panels/sidebar/Sidebar'
import { buildFileTree } from './panels/sidebar/buildFileTree'
import { EditorPanel } from './panels/editor/EditorPanel'
import { GraphPanel } from './panels/graph/GraphPanel'
import { GraphControls } from './panels/graph/GraphControls'
import { SkillsPanel } from './panels/skills/SkillsPanel'
import { TerminalPanel } from './panels/terminal/TerminalPanel'
import { WelcomeScreen } from './panels/onboarding/WelcomeScreen'
import { CommandPalette, type CommandItem } from './design/components/CommandPalette'
import { useKeyboard } from './hooks/useKeyboard'
import { useVaultStore } from './store/vault-store'
import { useEditorStore } from './store/editor-store'
import { useGraphStore } from './store/graph-store'
import { colors } from './design/tokens'
import { Titlebar } from './components/Titlebar'
import { SettingsModal } from './components/SettingsModal'
import { PanelErrorBoundary } from './components/PanelErrorBoundary'
import { StatusBar } from './components/StatusBar'
import type { ArtifactType } from '@shared/types'

function ContentArea() {
  const contentView = useGraphStore((s) => s.contentView)
  const setActiveNote = useEditorStore((s) => s.setActiveNote)
  const setContentView = useGraphStore((s) => s.setContentView)

  const handleNodeClick = useCallback(
    (id: string) => {
      setActiveNote(id, null)
      setContentView('editor')
    },
    [setActiveNote, setContentView]
  )

  const handleNavigate = useCallback(
    (id: string) => {
      setActiveNote(id, null)
    },
    [setActiveNote]
  )

  return (
    <div className="h-full relative">
      <GraphControls />
      {contentView === 'graph' && <GraphPanel onNodeClick={handleNodeClick} />}
      {contentView === 'editor' && <EditorPanel onNavigate={handleNavigate} />}
      {contentView === 'skills' && <SkillsPanel />}
    </div>
  )
}

function ConnectedSidebar() {
  const files = useVaultStore((s) => s.files)
  const config = useVaultStore((s) => s.config)
  const activeWorkspace = useVaultStore((s) => s.activeWorkspace)
  const setActiveWorkspace = useVaultStore((s) => s.setActiveWorkspace)
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const artifacts = useVaultStore((s) => s.artifacts)
  const fileToId = useVaultStore((s) => s.fileToId)
  const setActiveNote = useEditorStore((s) => s.setActiveNote)
  const setContent = useEditorStore((s) => s.setContent)
  const activeNotePath = useEditorStore((s) => s.activeNotePath)
  const setContentView = useGraphStore((s) => s.setContentView)
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set())
  const [sortMode, setSortMode] = useState<'modified' | 'name' | 'type'>('modified')

  const treeNodes = useMemo(() => {
    const paths = files.map((f) => f.path)
    return buildFileTree(paths, vaultPath ?? '')
  }, [files, vaultPath])

  const artifactTypes = useMemo(() => {
    const map = new Map<string, ArtifactType>()
    // Invert fileToId: path -> artifactId, then look up each artifact's type
    for (const [filePath, artifactId] of Object.entries(fileToId)) {
      const artifact = artifacts.find((a) => a.id === artifactId)
      if (artifact) {
        map.set(filePath, artifact.type)
      }
    }
    return map
  }, [artifacts, fileToId])

  const handleFileSelect = useCallback(
    async (path: string) => {
      setActiveNote(path, path)
      setContentView('editor')
      try {
        const fileContent = await window.api.fs.readFile(path)
        setContent(fileContent)
      } catch {
        setContent('')
      }
    },
    [setActiveNote, setContentView, setContent]
  )

  const handleSearch = useCallback((_query: string) => {
    // TODO: wire to vault index search
  }, [])

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

  const handleNewFile = useCallback(() => {
    // TODO: create new file in vault
  }, [])

  const handleNewFolder = useCallback(() => {
    // TODO: create new folder in vault
  }, [])

  const handleFileAction = useCallback(
    async (action: { actionId: string; path: string; isDirectory: boolean }) => {
      switch (action.actionId) {
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
          // If the deleted file was active, clear the editor
          if (action.path === activeNotePath) {
            setActiveNote(null, null)
            setContent('')
          }
          break
        }
      }
    },
    [activeNotePath, setActiveNote, setContent]
  )

  return (
    <Sidebar
      nodes={treeNodes}
      workspaces={config?.workspaces ?? []}
      activeWorkspace={activeWorkspace}
      activeFilePath={activeNotePath}
      collapsedPaths={collapsedPaths}
      artifactTypes={artifactTypes}
      sortMode={sortMode}
      onSearch={handleSearch}
      onWorkspaceSelect={setActiveWorkspace}
      onFileSelect={handleFileSelect}
      onToggleDirectory={handleToggleDirectory}
      onNewFile={handleNewFile}
      onNewFolder={handleNewFolder}
      onSortChange={setSortMode}
      onFileAction={handleFileAction}
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
  { id: 'cmd:zoom-to-fit', label: 'Zoom to Fit Graph', category: 'command' }
]

function WorkspaceShell() {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const files = useVaultStore((s) => s.files)
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const setActiveNote = useEditorStore((s) => s.setActiveNote)
  const contentView = useGraphStore((s) => s.contentView)
  const setContentView = useGraphStore((s) => s.setContentView)
  const mode = useEditorStore((s) => s.mode)
  const setMode = useEditorStore((s) => s.setMode)
  const vaultName = vaultPath?.split('/').pop() ?? 'Thought Engine'

  const toggleView = useCallback(() => {
    if (contentView === 'editor') setContentView('graph')
    else if (contentView === 'graph') setContentView('skills')
    else setContentView('graph')
  }, [contentView, setContentView])

  const toggleSourceMode = useCallback(() => {
    setMode(mode === 'rich' ? 'source' : 'rich')
  }, [mode, setMode])

  useKeyboard({
    onCommandPalette: () => setPaletteOpen(true),
    onCycleView: toggleView,
    onToggleSourceMode: toggleSourceMode,
    onEscape: () => setPaletteOpen(false)
  })

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
    (item: CommandItem) => {
      if (item.id.startsWith('note:')) {
        const path = item.id.slice(5)
        setActiveNote(path, path)
        setContentView('editor')
      } else if (item.id === 'cmd:toggle-view') {
        toggleView()
      } else if (item.id === 'cmd:toggle-mode') {
        toggleSourceMode()
      } else if (item.id === 'cmd:open-settings') {
        setSettingsOpen(true)
      } else if (item.id === 'cmd:reindex-vault') {
        // TODO: trigger vault re-index
      } else if (item.id === 'cmd:zoom-to-fit') {
        // TODO: trigger graph zoom-to-fit
      }
    },
    [setActiveNote, setContentView, toggleView, toggleSourceMode, setSettingsOpen]
  )

  return (
    <div
      className="h-screen w-screen flex flex-col"
      style={{ backgroundColor: colors.bg.base, color: colors.text.primary }}
    >
      <Titlebar vaultName={vaultName} onOpenSettings={() => setSettingsOpen(true)} />
      <div className="flex-1 overflow-hidden">
        <SplitPane
          left={
            <PanelErrorBoundary name="Sidebar">
              <ConnectedSidebar />
            </PanelErrorBoundary>
          }
          right={
            <SplitPane
              left={
                <PanelErrorBoundary name="Content">
                  <ContentArea />
                </PanelErrorBoundary>
              }
              right={
                <PanelErrorBoundary name="Terminal">
                  <TerminalPanel />
                </PanelErrorBoundary>
              }
              initialLeftWidth={580}
              minLeftWidth={300}
              minRightWidth={400}
            />
          }
          initialLeftWidth={240}
          minLeftWidth={0}
          minRightWidth={500}
        />
      </div>
      <StatusBar />
      <CommandPalette
        isOpen={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={paletteItems}
        onSelect={handlePaletteSelect}
      />
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
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
  const setWorkerResult = useVaultStore((s) => s.setWorkerResult)
  const setFiles = useVaultStore((s) => s.setFiles)

  const onWorkerResult = useCallback(
    (result: { artifacts: any[]; graph: any; errors: any[]; fileToId: Record<string, string> }) => {
      setWorkerResult(result)
      const files = useVaultStore.getState().files
      const updatedFiles = files.map((f) => {
        const id = result.fileToId[f.path]
        const artifact = id ? result.artifacts.find((a: any) => a.id === id) : undefined
        return artifact ? { ...f, title: artifact.title, modified: artifact.modified } : f
      })
      setFiles(updatedFiles)
    },
    [setWorkerResult, setFiles]
  )

  const { loadFiles, updateFile, removeFile } = useVaultWorker(onWorkerResult)

  const orchestrateLoad = useCallback(
    async (path: string) => {
      await window.api.vault.init(path)
      await loadVault(path)
      const state = useVaultStore.getState().state
      if (state) {
        if (state.contentView)
          useGraphStore
            .getState()
            .setContentView(state.contentView as 'editor' | 'graph' | 'skills')
        if (state.selectedNodeId) useGraphStore.getState().setSelectedNode(state.selectedNodeId)
        if (state.lastOpenNote)
          useEditorStore.getState().setActiveNote(state.lastOpenNote, state.lastOpenNote)
      }
      window.api.config.write('app', 'lastVaultPath', path)
      await window.api.vault.watchStart(path)
      const filePaths = useVaultStore.getState().files.map((f) => f.path)
      const filesWithContent = await Promise.all(
        filePaths.map(async (p) => ({ path: p, content: await window.api.fs.readFile(p) }))
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
    const unsub = window.api.on.fileChanged(async (data) => {
      if (data.event === 'unlink') {
        removeFile(data.path)
      } else {
        updateFile(data.path, await window.api.fs.readFile(data.path))
      }
    })
    return () => {
      unsub()
    }
  }, [updateFile, removeFile])

  return (
    <ThemeProvider>
      {isLoading ? (
        <LoadingSkeleton />
      ) : vaultPath ? (
        <WorkspaceShell />
      ) : (
        <WelcomeScreen onVaultSelected={orchestrateLoad} />
      )}
    </ThemeProvider>
  )
}
