import { FileText, FolderClosed, FolderOpen } from 'lucide-react'
import { colors, getArtifactColor } from '../../design/tokens'
import type { ArtifactType } from '@shared/types'
import type { FlatTreeNode } from './buildFileTree'
import { RenameInput } from './FileContextMenu'
import { TE_FILE_MIME, inferCardType, type DragFileData } from '../canvas/file-drop-utils'

export interface FileTreeProps {
  nodes: FlatTreeNode[]
  activeFilePath: string | null
  collapsedPaths: Set<string>
  artifactTypes?: Map<string, ArtifactType>
  onCanvasPaths?: ReadonlySet<string>
  canvasConnectionCounts?: ReadonlyMap<string, number>
  onFileSelect: (path: string) => void
  onToggleDirectory: (path: string) => void
  onContextMenu?: (e: React.MouseEvent, path: string, isDirectory: boolean) => void
  renamingPath?: string | null
  onRenameConfirm?: (newName: string) => void
  onRenameCancel?: () => void
}

// Walk up the parentPath chain; return true if any ancestor is collapsed.
function isVisible(
  node: FlatTreeNode,
  collapsedPaths: Set<string>,
  allNodes: FlatTreeNode[]
): boolean {
  let currentParent = node.parentPath

  while (currentParent) {
    const parentNode = allNodes.find((n) => n.isDirectory && n.path === currentParent)
    if (!parentNode) break
    if (collapsedPaths.has(parentNode.path)) return false
    currentParent = parentNode.parentPath
  }

  return true
}

/** Split filename into base name and extension for separate styling */
function splitName(name: string): { base: string; ext: string } {
  const dotIdx = name.lastIndexOf('.')
  if (dotIdx <= 0) return { base: name, ext: '' }
  return { base: name.slice(0, dotIdx), ext: name.slice(dotIdx) }
}

/** Inline SVG chevron pointing right, rotated via CSS when expanded */
function Chevron({ isExpanded }: { isExpanded: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{
        transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
        transition: 'transform 150ms ease-out',
        flexShrink: 0
      }}
    >
      <path
        d="M6 4L10 8L6 12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function FileTree({
  nodes,
  activeFilePath,
  collapsedPaths,
  artifactTypes,
  onCanvasPaths,
  canvasConnectionCounts,
  onFileSelect,
  onToggleDirectory,
  onContextMenu,
  renamingPath,
  onRenameConfirm,
  onRenameCancel
}: FileTreeProps) {
  const visibleNodes = nodes.filter((n) => isVisible(n, collapsedPaths, nodes))

  return (
    <div data-testid="file-tree" className="text-sm select-none px-1 py-1">
      {visibleNodes.map((node) =>
        node.isDirectory ? (
          <DirectoryRow
            key={node.path}
            node={node}
            isCollapsed={collapsedPaths.has(node.path)}
            onToggleDirectory={onToggleDirectory}
            onContextMenu={onContextMenu}
            isRenaming={renamingPath === node.path}
            onRenameConfirm={onRenameConfirm}
            onRenameCancel={onRenameCancel}
          />
        ) : (
          <FileRow
            key={node.path}
            node={node}
            isActive={node.path === activeFilePath}
            artifactType={artifactTypes?.get(node.path)}
            isOnCanvas={onCanvasPaths?.has(node.path) ?? false}
            canvasConnectionCount={canvasConnectionCounts?.get(node.path) ?? 0}
            onFileSelect={onFileSelect}
            onContextMenu={onContextMenu}
            isRenaming={renamingPath === node.path}
            onRenameConfirm={onRenameConfirm}
            onRenameCancel={onRenameCancel}
          />
        )
      )}
    </div>
  )
}

function DirectoryRow({
  node,
  isCollapsed,
  onToggleDirectory,
  onContextMenu,
  isRenaming,
  onRenameConfirm,
  onRenameCancel
}: {
  node: FlatTreeNode
  isCollapsed: boolean
  onToggleDirectory: (path: string) => void
  onContextMenu?: (e: React.MouseEvent, path: string, isDirectory: boolean) => void
  isRenaming?: boolean
  onRenameConfirm?: (newName: string) => void
  onRenameCancel?: () => void
}) {
  const paddingLeft = 8 + node.depth * 16

  return (
    <div
      onClick={() => onToggleDirectory(node.path)}
      onContextMenu={(e) => onContextMenu?.(e, node.path, true)}
      className="flex items-center py-0.5 cursor-pointer rounded transition-colors"
      style={{
        paddingLeft,
        paddingRight: 8,
        marginBottom: 1,
        color: colors.text.primary,
        fontWeight: 500,
        fontSize: 13
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = ''
      }}
    >
      <span className="mr-1.5 flex items-center" style={{ color: colors.text.muted }}>
        <Chevron isExpanded={!isCollapsed} />
      </span>
      <span className="mr-1.5 flex items-center" style={{ color: colors.text.muted, opacity: 0.6 }}>
        {isCollapsed ? (
          <FolderClosed size={14} strokeWidth={1.5} />
        ) : (
          <FolderOpen size={14} strokeWidth={1.5} />
        )}
      </span>
      {isRenaming ? (
        <RenameInput
          initialValue={node.name}
          onConfirm={onRenameConfirm ?? (() => {})}
          onCancel={onRenameCancel ?? (() => {})}
        />
      ) : (
        <span className="truncate flex-1">{node.name}</span>
      )}
      {!isRenaming && node.itemCount > 0 && (
        <span
          className="ml-auto text-[11px]"
          style={{
            color: colors.text.muted,
            opacity: 0.4,
            fontVariantNumeric: 'tabular-nums'
          }}
        >
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
  isOnCanvas,
  canvasConnectionCount,
  onFileSelect,
  onContextMenu,
  isRenaming,
  onRenameConfirm,
  onRenameCancel
}: {
  node: FlatTreeNode
  isActive: boolean
  artifactType?: ArtifactType
  isOnCanvas: boolean
  canvasConnectionCount: number
  onFileSelect: (path: string) => void
  onContextMenu?: (e: React.MouseEvent, path: string, isDirectory: boolean) => void
  isRenaming?: boolean
  onRenameConfirm?: (newName: string) => void
  onRenameCancel?: () => void
}) {
  const paddingLeft = 8 + node.depth * 16 + 20
  const { base, ext } = splitName(node.name)

  // Icon color: artifact type color when available, accent when on canvas, muted otherwise
  const iconColor = artifactType
    ? getArtifactColor(artifactType)
    : isOnCanvas
      ? colors.accent.default
      : colors.text.muted

  // Canvas glow on the icon
  const canvasGlow = isOnCanvas ? `drop-shadow(0 0 4px ${colors.accent.default})` : undefined

  return (
    <div
      data-active={isActive ? 'true' : 'false'}
      onMouseDown={(e) => {
        if (e.button === 0) {
          e.currentTarget.setAttribute('draggable', 'true')
        }
      }}
      onDragStart={(e) => {
        const data: DragFileData = { path: node.path, type: inferCardType(node.path) }
        e.dataTransfer.setData(TE_FILE_MIME, JSON.stringify(data))
        e.dataTransfer.effectAllowed = 'copy'
      }}
      onDragEnd={(e) => {
        e.currentTarget.setAttribute('draggable', 'false')
      }}
      onMouseUp={(e) => {
        e.currentTarget.setAttribute('draggable', 'false')
      }}
      onClick={() => onFileSelect(node.path)}
      onContextMenu={(e) => onContextMenu?.(e, node.path, false)}
      className="flex items-center py-0.5 cursor-pointer rounded transition-colors"
      style={{
        paddingLeft,
        paddingRight: 8,
        marginBottom: 1,
        backgroundColor: isActive ? 'rgba(255, 255, 255, 0.08)' : undefined,
        color: isActive ? colors.text.primary : colors.text.secondary,
        fontWeight: 400,
        fontSize: 13
      }}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)'
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.backgroundColor = ''
      }}
    >
      <span
        className="mr-1.5 flex-shrink-0 flex items-center"
        style={{
          color: iconColor,
          opacity: isOnCanvas ? 1 : 0.6,
          filter: canvasGlow,
          transition: 'filter 150ms ease-out, color 150ms ease-out'
        }}
        title={isOnCanvas ? 'on canvas' : artifactType ?? undefined}
      >
        <FileText size={14} strokeWidth={1.5} />
      </span>
      {isRenaming ? (
        <RenameInput
          initialValue={node.name}
          onConfirm={onRenameConfirm ?? (() => {})}
          onCancel={onRenameCancel ?? (() => {})}
        />
      ) : (
        <span className="truncate flex-1">
          {base}
          {ext && (
            <span style={{ color: colors.text.muted, opacity: 0.4 }}>{ext}</span>
          )}
        </span>
      )}
      {canvasConnectionCount >= 2 && (
        <span
          className="ml-auto flex-shrink-0"
          style={{
            color: colors.accent.default,
            opacity: 0.6,
            fontSize: 10,
            fontVariantNumeric: 'tabular-nums'
          }}
        >
          {canvasConnectionCount}
        </span>
      )}
    </div>
  )
}
