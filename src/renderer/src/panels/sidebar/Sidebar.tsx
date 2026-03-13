import { SearchBar } from './SearchBar'
import { WorkspaceFilter } from './WorkspaceFilter'
import { FileTree, type FileTreeItem } from './FileTree'
import { colors } from '../../design/tokens'

interface SidebarProps {
  items: FileTreeItem[]
  workspaces: string[]
  activeWorkspace: string | null
  activeFilePath: string | null
  onSearch: (query: string) => void
  onWorkspaceSelect: (workspace: string | null) => void
  onFileSelect: (path: string) => void
  onToggleDirectory: (path: string) => void
}

export function Sidebar({
  items,
  workspaces,
  activeWorkspace,
  activeFilePath,
  onSearch,
  onWorkspaceSelect,
  onFileSelect,
  onToggleDirectory
}: SidebarProps) {
  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: colors.bg.surface }}>
      <div className="p-2 border-b" style={{ borderColor: colors.border.default }}>
        <SearchBar onSearch={onSearch} />
      </div>
      {workspaces.length > 0 && (
        <WorkspaceFilter
          workspaces={workspaces}
          active={activeWorkspace}
          onSelect={onWorkspaceSelect}
        />
      )}
      <div className="flex-1 overflow-y-auto">
        <FileTree
          items={items}
          activeFilePath={activeFilePath}
          onFileSelect={onFileSelect}
          onToggleDirectory={onToggleDirectory}
        />
      </div>
    </div>
  )
}
