import { colors, ARTIFACT_COLORS } from '../../design/tokens'
import type { ArtifactType } from '@shared/types'
import type { FlatTreeNode } from './buildFileTree'

export interface FileTreeProps {
  nodes: FlatTreeNode[]
  activeFilePath: string | null
  collapsedPaths: Set<string>
  artifactTypes?: Map<string, ArtifactType>
  onFileSelect: (path: string) => void
  onToggleDirectory: (path: string) => void
}

// Walk up the parentPath chain; return true if any ancestor is collapsed.
function isVisible(node: FlatTreeNode, collapsedPaths: Set<string>, allNodes: FlatTreeNode[]): boolean {
  let currentParent = node.parentPath

  while (currentParent) {
    // Find the directory node that owns this parentPath
    const parentNode = allNodes.find((n) => n.isDirectory && n.path === currentParent)
    if (!parentNode) break

    if (collapsedPaths.has(parentNode.path)) {
      return false
    }

    currentParent = parentNode.parentPath
  }

  return true
}

export function FileTree({
  nodes,
  activeFilePath,
  collapsedPaths,
  artifactTypes,
  onFileSelect,
  onToggleDirectory
}: FileTreeProps) {
  const visibleNodes = nodes.filter((n) => isVisible(n, collapsedPaths, nodes))

  return (
    <div className="text-sm select-none">
      {visibleNodes.map((node) =>
        node.isDirectory ? (
          <DirectoryRow
            key={node.path}
            node={node}
            isCollapsed={collapsedPaths.has(node.path)}
            onToggleDirectory={onToggleDirectory}
          />
        ) : (
          <FileRow
            key={node.path}
            node={node}
            isActive={node.path === activeFilePath}
            artifactType={artifactTypes?.get(node.path)}
            onFileSelect={onFileSelect}
          />
        )
      )}
    </div>
  )
}

function DirectoryRow({
  node,
  isCollapsed,
  onToggleDirectory
}: {
  node: FlatTreeNode
  isCollapsed: boolean
  onToggleDirectory: (path: string) => void
}) {
  const paddingLeft = 12 + node.depth * 16

  return (
    <div
      onClick={() => onToggleDirectory(node.path)}
      className="flex items-center py-0.5 cursor-pointer hover:bg-[#1A1A1D] transition-colors"
      style={{ paddingLeft, color: colors.text.secondary }}
    >
      <span
        className="mr-1 text-xs inline-block transition-transform"
        style={{ transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}
      >
        {'\u25B8'}
      </span>
      <span className="truncate flex-1">{node.name}</span>
      {node.itemCount > 0 && (
        <span className="ml-auto mr-2 text-xs" style={{ color: colors.text.muted }}>
          {node.itemCount}
        </span>
      )}
    </div>
  )
}

function FileRow({
  node,
  isActive,
  artifactType,
  onFileSelect
}: {
  node: FlatTreeNode
  isActive: boolean
  artifactType?: ArtifactType
  onFileSelect: (path: string) => void
}) {
  const paddingLeft = 12 + node.depth * 16

  return (
    <div
      data-active={isActive ? 'true' : 'false'}
      onClick={() => onFileSelect(node.path)}
      className="flex items-center py-0.5 cursor-pointer hover:bg-[#1A1A1D] transition-colors"
      style={{
        paddingLeft,
        backgroundColor: isActive ? colors.accent.muted : undefined,
        color: isActive ? colors.text.primary : colors.text.secondary
      }}
    >
      {artifactType && (
        <span
          className="w-2 h-2 rounded-full mr-2 flex-shrink-0"
          style={{ backgroundColor: ARTIFACT_COLORS[artifactType] }}
        />
      )}
      <span className="truncate flex-1">{node.name}</span>
    </div>
  )
}
