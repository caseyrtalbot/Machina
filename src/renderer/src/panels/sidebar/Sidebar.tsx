import { useState, useCallback } from 'react'

import { colors } from '../../design/tokens'
import { FileContextMenu } from './FileContextMenu'
import { FileTree } from './FileTree'
import { SearchBar } from './SearchBar'
import { VaultSelector } from './VaultSelector'
import { WorkspaceFilter } from './WorkspaceFilter'
import type { ArtifactType } from '@shared/types'
import type { FlatTreeNode } from './buildFileTree'
import type { FileContextMenuState } from './FileContextMenu'

type SortMode = 'modified' | 'name' | 'type'

export interface FileAction {
  readonly actionId: string
  readonly path: string
  readonly isDirectory: boolean
}

interface SidebarProps {
  nodes: FlatTreeNode[]
  workspaces: string[]
  activeWorkspace: string | null
  activeFilePath: string | null
  collapsedPaths: Set<string>
  artifactTypes?: Map<string, ArtifactType>
  onCanvasPaths?: ReadonlySet<string>
  canvasConnectionCounts?: ReadonlyMap<string, number>
  sortMode?: SortMode
  vaultName?: string
  vaultHistory?: readonly string[]
  onSearch: (query: string) => void
  onWorkspaceSelect: (workspace: string | null) => void
  onFileSelect: (path: string) => void
  onToggleDirectory: (path: string) => void
  onNewFile?: () => void
  onSortChange?: (mode: SortMode) => void
  onFileAction?: (action: FileAction) => void
  onSelectVault?: (path: string) => void
  onSelectClaudeConfig?: () => void
  onOpenVaultPicker?: () => void
  onRemoveFromHistory?: (path: string) => void
}

function ActionBar({
  sortMode = 'modified',
  vaultName,
  vaultHistory = [],
  onNewFile,
  onSortChange,
  onSelectVault,
  onSelectClaudeConfig,
  onOpenVaultPicker,
  onRemoveFromHistory
}: {
  sortMode?: SortMode
  vaultName?: string
  vaultHistory?: readonly string[]
  onNewFile?: () => void
  onSortChange?: (mode: SortMode) => void
  onSelectVault?: (path: string) => void
  onSelectClaudeConfig?: () => void
  onOpenVaultPicker?: () => void
  onRemoveFromHistory?: (path: string) => void
}) {
  return (
    <div className="flex flex-col gap-1 px-2 py-1">
      {vaultName && onSelectVault && onSelectClaudeConfig && onOpenVaultPicker && (
        <VaultSelector
          currentName={vaultName}
          history={vaultHistory}
          onSelectVault={onSelectVault}
          onOpenPicker={onOpenVaultPicker}
          onSelectClaudeConfig={onSelectClaudeConfig}
          onRemoveFromHistory={onRemoveFromHistory}
        />
      )}
      <div className="flex items-center gap-1 text-xs" style={{ color: colors.text.muted }}>
        <button
          onClick={onNewFile}
          className="px-2 py-0.5 rounded hover:bg-[var(--color-bg-elevated)] transition-colors cursor-pointer"
          title="New file"
        >
          + File
        </button>
        <div className="flex-1" />
        <select
          value={sortMode}
          onChange={(e) => onSortChange?.(e.target.value as SortMode)}
          className="bg-transparent text-xs cursor-pointer"
          style={{ color: colors.text.muted }}
        >
          <option value="modified">Modified</option>
          <option value="name">Name</option>
          <option value="type">Type</option>
        </select>
      </div>
    </div>
  )
}

export function Sidebar({
  nodes,
  workspaces,
  activeWorkspace,
  activeFilePath,
  collapsedPaths,
  artifactTypes,
  onCanvasPaths,
  canvasConnectionCounts,
  sortMode = 'modified',
  vaultName,
  vaultHistory,
  onSearch,
  onWorkspaceSelect,
  onFileSelect,
  onToggleDirectory,
  onNewFile,
  onSortChange,
  onFileAction,
  onSelectVault,
  onSelectClaudeConfig,
  onOpenVaultPicker,
  onRemoveFromHistory
}: SidebarProps) {
  const [contextMenu, setContextMenu] = useState<FileContextMenuState | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, path: string, isDirectory: boolean) => {
      e.preventDefault()
      e.stopPropagation()
      setContextMenu({ x: e.clientX, y: e.clientY, path, isDirectory })
    },
    []
  )

  const handleContextMenuAction = useCallback(
    (actionId: string, path: string) => {
      if (actionId === 'rename') {
        setRenamingPath(path)
        return
      }
      const node = nodes.find((n) => n.path === path)
      onFileAction?.({ actionId, path, isDirectory: node?.isDirectory ?? false })
    },
    [nodes, onFileAction]
  )

  const handleRenameConfirm = useCallback(
    (newName: string) => {
      if (!renamingPath) return
      const node = nodes.find((n) => n.path === renamingPath)
      const isDirectory = node?.isDirectory ?? false
      onFileAction?.({ actionId: 'rename-confirm', path: renamingPath, isDirectory })
      const parentDir = renamingPath.split('/').slice(0, -1).join('/')
      const newPath = `${parentDir}/${newName}`
      window.api.fs
        .renameFile(renamingPath, newPath)
        .then(() => setRenamingPath(null))
        .catch(() => setRenamingPath(null))
    },
    [renamingPath, nodes, onFileAction]
  )

  return (
    <div className="h-full flex flex-col">
      <div className="p-2">
        <SearchBar onSearch={onSearch} />
      </div>
      <ActionBar
        sortMode={sortMode}
        vaultName={vaultName}
        vaultHistory={vaultHistory}
        onNewFile={onNewFile}
        onSortChange={onSortChange}
        onSelectVault={onSelectVault}
        onSelectClaudeConfig={onSelectClaudeConfig}
        onOpenVaultPicker={onOpenVaultPicker}
        onRemoveFromHistory={onRemoveFromHistory}
      />
      {workspaces.length > 0 && (
        <WorkspaceFilter
          workspaces={workspaces}
          active={activeWorkspace}
          onSelect={onWorkspaceSelect}
        />
      )}
      <div className="flex-1 overflow-y-auto">
        <FileTree
          nodes={nodes}
          activeFilePath={activeFilePath}
          collapsedPaths={collapsedPaths}
          artifactTypes={artifactTypes}
          onCanvasPaths={onCanvasPaths}
          canvasConnectionCounts={canvasConnectionCounts}
          onFileSelect={onFileSelect}
          onToggleDirectory={onToggleDirectory}
          onContextMenu={handleContextMenu}
          renamingPath={renamingPath}
          onRenameConfirm={handleRenameConfirm}
          onRenameCancel={() => setRenamingPath(null)}
        />
      </div>

      <FileContextMenu
        state={contextMenu}
        onClose={() => setContextMenu(null)}
        onAction={handleContextMenuAction}
      />
    </div>
  )
}
