import { useState, useCallback } from 'react'
import { SearchBar } from './SearchBar'
import { WorkspaceFilter } from './WorkspaceFilter'
import { FileTree } from './FileTree'
import { FileContextMenu } from './FileContextMenu'
import type { FileContextMenuState } from './FileContextMenu'
import type { FlatTreeNode } from './buildFileTree'
import type { ArtifactType } from '@shared/types'
import { colors } from '../../design/tokens'

const hoverBgStyle = { '--color-bg-elevated': colors.bg.elevated } as React.CSSProperties

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
  sortMode?: SortMode
  onSearch: (query: string) => void
  onWorkspaceSelect: (workspace: string | null) => void
  onFileSelect: (path: string) => void
  onToggleDirectory: (path: string) => void
  onNewFile?: () => void
  onNewFolder?: () => void
  onSortChange?: (mode: SortMode) => void
  onFileAction?: (action: FileAction) => void
}

function ActionBar({
  sortMode = 'modified',
  onNewFile,
  onNewFolder,
  onSortChange
}: {
  sortMode?: SortMode
  onNewFile?: () => void
  onNewFolder?: () => void
  onSortChange?: (mode: SortMode) => void
}) {
  return (
    <div
      className="flex items-center gap-1 px-2 py-1 border-b text-xs"
      style={{ borderColor: 'var(--border-subtle)', color: colors.text.secondary }}
    >
      <button
        onClick={onNewFile}
        className="px-2 py-0.5 rounded hover:bg-[var(--color-bg-elevated)] transition-colors cursor-pointer"
        style={hoverBgStyle}
        title="New file"
      >
        + File
      </button>
      <button
        onClick={onNewFolder}
        className="px-2 py-0.5 rounded hover:bg-[var(--color-bg-elevated)] transition-colors cursor-pointer"
        style={hoverBgStyle}
        title="Open a different vault"
      >
        Open Vault
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
  )
}

export function Sidebar({
  nodes,
  workspaces,
  activeWorkspace,
  activeFilePath,
  collapsedPaths,
  artifactTypes,
  sortMode = 'modified',
  onSearch,
  onWorkspaceSelect,
  onFileSelect,
  onToggleDirectory,
  onNewFile,
  onNewFolder,
  onSortChange,
  onFileAction
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
      onFileAction?.({ actionId: 'rename-confirm', path: renamingPath, isDirectory: false })
      // The actual rename is handled by the parent via the newName
      // We pass it through a slightly different mechanism
      const parentDir = renamingPath.split('/').slice(0, -1).join('/')
      const newPath = `${parentDir}/${newName}`
      window.api.fs
        .renameFile(renamingPath, newPath)
        .then(() => {
          setRenamingPath(null)
        })
        .catch(() => {
          setRenamingPath(null)
        })
    },
    [renamingPath, onFileAction]
  )

  return (
    <div className="h-full flex flex-col">
      <div className="p-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <SearchBar onSearch={onSearch} />
      </div>
      <ActionBar
        sortMode={sortMode}
        onNewFile={onNewFile}
        onNewFolder={onNewFolder}
        onSortChange={onSortChange}
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
