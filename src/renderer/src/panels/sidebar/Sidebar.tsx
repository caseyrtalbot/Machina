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
  onFileDoubleClick?: (path: string) => void
  onToggleDirectory: (path: string) => void
  onNewFile?: () => void
  onSortChange?: (mode: SortMode) => void
  onFileAction?: (action: FileAction) => void
  onSelectVault?: (path: string) => void
  onSelectClaudeConfig?: () => void
  onOpenVaultPicker?: () => void
  onRemoveFromHistory?: (path: string) => void
  onOpenSettings?: () => void
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
  onRemoveFromHistory,
  onOpenSettings
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
  onOpenSettings?: () => void
}) {
  return (
    <div className="flex flex-col gap-1 px-2 py-1">
      <div className="flex items-center">
        {vaultName && onSelectVault && onSelectClaudeConfig && onOpenVaultPicker ? (
          <div className="flex-1 min-w-0">
            <VaultSelector
              currentName={vaultName}
              history={vaultHistory}
              onSelectVault={onSelectVault}
              onOpenPicker={onOpenVaultPicker}
              onSelectClaudeConfig={onSelectClaudeConfig}
              onRemoveFromHistory={onRemoveFromHistory}
            />
          </div>
        ) : (
          <div className="flex-1" />
        )}
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            className="flex items-center justify-center shrink-0 rounded cursor-pointer transition-opacity"
            style={{ width: 28, height: 28, color: colors.text.muted, opacity: 0.6 }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '1'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '0.6'
            }}
            title="Settings"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 4.754a3.246 3.246 0 100 6.492 3.246 3.246 0 000-6.492zM5.754 8a2.246 2.246 0 114.492 0 2.246 2.246 0 01-4.492 0z" />
              <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 01-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 01-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 01.52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 011.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 011.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 01.52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 01-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 01-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 002.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 001.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 00-1.115 2.693l.16.291c.415.764-.421 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 00-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 00-2.692-1.115l-.292.16c-.764.415-1.6-.421-1.184-1.185l.159-.291A1.873 1.873 0 001.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 003.06 4.377l-.16-.292c-.415-.764.421-1.6 1.185-1.184l.292.159a1.873 1.873 0 002.692-1.115l.094-.319z" />
            </svg>
          </button>
        )}
      </div>
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
  onFileDoubleClick,
  onToggleDirectory,
  onNewFile,
  onSortChange,
  onFileAction,
  onSelectVault,
  onSelectClaudeConfig,
  onOpenVaultPicker,
  onRemoveFromHistory,
  onOpenSettings
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
        onOpenSettings={onOpenSettings}
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
          onFileDoubleClick={onFileDoubleClick}
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
