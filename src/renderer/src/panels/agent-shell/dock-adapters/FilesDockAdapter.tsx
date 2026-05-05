import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ArtifactType } from '@shared/types'
import { isSystemArtifactKind } from '@shared/system-artifacts'
import { Sidebar } from '../../sidebar/Sidebar'
import type { SystemArtifactListItem } from '../../sidebar/Sidebar'
import { buildFileTree } from '../../sidebar/buildFileTree'
import type { ArtifactOrigin } from '../../sidebar/origin-utils'
import { useVaultStore } from '../../../store/vault-store'
import { useEditorStore } from '../../../store/editor-store'
import { useSidebarSelectionStore } from '../../../store/sidebar-selection-store'
import { useThreadStore } from '../../../store/thread-store'
import { useCanvasFilePaths, useCanvasConnectionCounts } from '../../../hooks/useCanvasAwareness'
import { useAgentStates } from '../../../hooks/use-agent-states'
import { openArtifactInEditor } from '../../../system-artifacts/system-artifact-runtime'
import { logError } from '../../../utils/error-logger'

type SortMode = 'modified' | 'modified-asc' | 'name' | 'name-desc' | 'type'

const EMPTY_SET = new Set<string>()

interface FilesDockAdapterProps {
  readonly onChangeVault?: () => void
  readonly onOpenSettings?: () => void
}

/**
 * Files surface — peer dock tab that mounts the full vault sidebar
 * (search, tree, bookmarks, tags, system artifacts) and
 * routes file selection through `openOrFocusDockTab` so each open file
 * becomes an Editor dock tab. Replaces the legacy `ConnectedSidebar`
 * that lived inside the pre-AgentShell three-panel layout.
 */
export function FilesDockAdapter({ onChangeVault, onOpenSettings }: FilesDockAdapterProps = {}) {
  const files = useVaultStore((s) => s.files)
  const config = useVaultStore((s) => s.config)
  const activeWorkspace = useVaultStore((s) => s.activeWorkspace)
  const setActiveWorkspace = useVaultStore((s) => s.setActiveWorkspace)
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const artifacts = useVaultStore((s) => s.artifacts)
  const fileToId = useVaultStore((s) => s.fileToId)
  const artifactPathById = useVaultStore((s) => s.artifactPathById)
  const activeNotePath = useEditorStore((s) => s.activeNotePath)
  const selectedPaths = useSidebarSelectionStore((s) => s.selectedPaths)

  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set())
  const [sortMode, setSortMode] = useState<SortMode>('name')
  const [searchQuery, setSearchQuery] = useState('')
  const [vaultHistory, setVaultHistory] = useState<string[]>([])

  // Vault history with on-load existence check.
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
      if (artifact) map.set(filePath, artifact.type)
    }
    return map
  }, [artifacts, fileToId])

  const artifactOrigins = useMemo(() => {
    const map = new Map<string, ArtifactOrigin>()
    const artifactById = new Map(artifacts.map((a) => [a.id, a]))
    for (const [filePath, artifactId] of Object.entries(fileToId)) {
      const artifact = artifactById.get(artifactId)
      if (artifact) map.set(filePath, artifact.origin)
    }
    return map
  }, [artifacts, fileToId])

  // Stabilize file ordering for non-mtime sorts so the tree does not jerk
  // during normal navigation. Same approach as legacy ConnectedSidebar.
  const [stableFiles, setStableFiles] = useState(files)
  const prevPathSetRef = useRef('')
  useEffect(() => {
    const pathKey = files.map((f) => f.path).join('\n')
    if (pathKey !== prevPathSetRef.current || sortMode !== 'modified') {
      prevPathSetRef.current = pathKey
      setStableFiles(files)
    }
  }, [files, sortMode])

  const allTreeNodes = useMemo(
    () =>
      buildFileTree(
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
      ),
    [artifactTypes, stableFiles, sortMode, vaultPath]
  )
  const allTreeNodeByPath = useMemo(
    () => new Map(allTreeNodes.map((node) => [node.path, node])),
    [allTreeNodes]
  )

  const treeNodes = useMemo(() => {
    if (!searchQuery.trim()) return allTreeNodes
    const query = searchQuery.toLowerCase()
    const matchingFiles = new Set(
      allTreeNodes
        .filter((n) => !n.isDirectory && n.name.toLowerCase().includes(query))
        .map((n) => n.path)
    )
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

  // Track the active vault agent (librarian/curator) for selection-store badging.
  const allAgentStates = useAgentStates()
  const vaultAgentAlive = useMemo(
    () =>
      allAgentStates.some(
        (s) => (s.label === 'librarian' || s.label === 'curator') && s.status === 'alive'
      ),
    [allAgentStates]
  )
  const activeVaultAgent = useMemo(
    () =>
      allAgentStates.find(
        (s) => (s.label === 'librarian' || s.label === 'curator') && s.status === 'alive'
      ),
    [allAgentStates]
  )
  const prevAgentRef = useRef<string | null>(null)
  if ((activeVaultAgent?.label ?? null) !== prevAgentRef.current) {
    prevAgentRef.current = activeVaultAgent?.label ?? null
    useSidebarSelectionStore.getState().setAgentActive(!!activeVaultAgent, activeVaultAgent?.label)
  }

  const handleFileSelect = useCallback(
    (path: string, e?: React.MouseEvent) => {
      const sel = useSidebarSelectionStore.getState()
      if (e?.metaKey) {
        sel.toggle(path)
        return
      }
      if (e?.shiftKey) {
        const filePaths = treeNodes.filter((n) => !n.isDirectory).map((n) => n.path)
        sel.selectRange(path, filePaths)
        return
      }
      sel.clear()
      const file = files.find((f) => f.path === path)
      openArtifactInEditor(path, file?.title)
    },
    [treeNodes, files]
  )

  const handleFileDoubleClick = useCallback(
    (path: string) => {
      const file = files.find((f) => f.path === path)
      openArtifactInEditor(path, file?.title)
    },
    [files]
  )

  const handleToggleDirectory = useCallback((path: string) => {
    setCollapsedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const handleNewFile = useCallback(async () => {
    if (!vaultPath) return
    const existingPaths = new Set(files.map((f) => f.path))
    let filename = 'Untitled.md'
    let counter = 1
    while (existingPaths.has(`${vaultPath}/${filename}`)) {
      filename = `Untitled ${counter}.md`
      counter += 1
    }
    const filePath = `${vaultPath}/${filename}`
    const now = new Date().toISOString().slice(0, 10)
    const title = filename.replace('.md', '')
    const content = `---\nid: ${title}\ntitle: ${title}\ncreated: ${now}\ntags: []\n---\n\n`
    await window.api.fs.writeFile(filePath, content)
    openArtifactInEditor(filePath, title)
  }, [vaultPath, files])

  const handleOpenVaultPicker = useCallback(async () => {
    const path = await window.api.fs.selectVault()
    if (!path) return
    onChangeVault?.()
    await window.api.vault.watchStop()
    await window.api.vault.watchStart(path)
    useVaultStore.getState().setVaultPath(path)
  }, [onChangeVault])

  const handleSelectVault = useCallback(
    async (path: string) => {
      const exists = await window.api.app.pathExists(path)
      if (!exists) {
        const history = (await window.api.config.read('app', 'vaultHistory')) as string[] | null
        const updated = (history ?? []).filter((p) => p !== path)
        await window.api.config.write('app', 'vaultHistory', updated)
        setVaultHistory(updated)
        return
      }
      onChangeVault?.()
      await window.api.vault.watchStop()
      await window.api.vault.watchStart(path)
      useVaultStore.getState().setVaultPath(path)
    },
    [onChangeVault]
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
          const dir = action.path
          const existingPaths = new Set(files.map((f) => f.path))
          let filename = 'Untitled.md'
          let counter = 1
          while (existingPaths.has(`${dir}/${filename}`)) {
            filename = `Untitled ${counter}.md`
            counter += 1
          }
          const filePath = `${dir}/${filename}`
          const now = new Date().toISOString().slice(0, 10)
          const title = filename.replace('.md', '')
          const content = `---\nid: ${title}\ntitle: ${title}\ncreated: ${now}\ntags: []\n---\n\n`
          await window.api.fs.writeFile(filePath, content)
          openArtifactInEditor(filePath, title)
          break
        }
        case 'new-folder': {
          const dir = action.path
          let folderName = 'New Folder'
          let counter = 1
          while (await window.api.fs.fileExists(`${dir}/${folderName}`).catch(() => false)) {
            folderName = `New Folder ${counter}`
            counter += 1
          }
          await window.api.fs.mkdir(`${dir}/${folderName}`)
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
          useEditorStore.getState().closeTab(action.path)
          const current = useVaultStore.getState().files
          useVaultStore.getState().setFiles(current.filter((f) => f.path !== action.path))
          // Drop a stale Editor dock tab for this path on the active thread.
          const thread = useThreadStore.getState()
          const threadId = thread.activeThreadId
          if (threadId) {
            const tabs = thread.dockTabsByThreadId[threadId] ?? []
            const idx = tabs.findIndex((t) => t.kind === 'editor' && t.path === action.path)
            if (idx >= 0) thread.removeDockTab(idx)
          }
          break
        }
      }
    },
    [files]
  )

  const handleMoveToFolder = useCallback(async (sourcePath: string, targetFolderPath: string) => {
    const filename = sourcePath.split('/').pop()
    if (!filename) return
    const newPath = `${targetFolderPath}/${filename}`
    try {
      await window.api.fs.renameFile(sourcePath, newPath)
    } catch {
      /* watcher will reconcile state */
    }
  }, [])

  const handleExternalFileDrop = useCallback(
    async (filePaths: readonly string[], targetFolderPath?: string) => {
      const destDir = targetFolderPath ?? vaultPath
      if (!destDir) return
      for (const srcPath of filePaths) {
        const filename = srcPath.split('/').pop()
        if (!filename) continue
        const destPath = `${destDir}/${filename}`
        try {
          await window.api.fs.copyFile(srcPath, destPath)
        } catch {
          /* watcher will reconcile state */
        }
      }
    },
    [vaultPath]
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
      selectedPaths={selectedPaths}
      agentActive={vaultAgentAlive}
      sortMode={sortMode}
      vaultName={vaultName}
      vaultHistory={vaultHistory}
      systemArtifacts={systemArtifacts}
      onSearch={setSearchQuery}
      onWorkspaceSelect={setActiveWorkspace}
      onFileSelect={handleFileSelect}
      onFileDoubleClick={handleFileDoubleClick}
      onSystemArtifactSelect={(item) => openArtifactInEditor(item.path, item.title)}
      onToggleDirectory={handleToggleDirectory}
      onNewFile={handleNewFile}
      onSortChange={setSortMode}
      onFileAction={handleFileAction}
      onMoveToFolder={handleMoveToFolder}
      onExternalFileDrop={handleExternalFileDrop}
      onSelectVault={handleSelectVault}
      onOpenVaultPicker={handleOpenVaultPicker}
      onRemoveFromHistory={handleRemoveFromHistory}
      onOpenSettings={onOpenSettings}
    />
  )
}
