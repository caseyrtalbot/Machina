import { SearchBar } from './SearchBar'
import { WorkspaceFilter } from './WorkspaceFilter'
import { FileTree } from './FileTree'
import type { FlatTreeNode } from './buildFileTree'
import type { ArtifactType } from '@shared/types'
import { colors } from '../../design/tokens'

const hoverBgStyle = { '--color-bg-elevated': colors.bg.elevated } as React.CSSProperties

type SortMode = 'modified' | 'name' | 'type'

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
      style={{ borderColor: colors.border.default, color: colors.text.secondary }}
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
        title="New folder"
      >
        + Folder
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
  onSortChange
}: SidebarProps) {
  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: colors.bg.surface }}>
      <div className="p-2 border-b" style={{ borderColor: colors.border.default }}>
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
        />
      </div>
    </div>
  )
}
