import { Fragment, memo, useMemo } from 'react'
import { TE_FILE_MIME, inferCardType, type DragFileData } from '../canvas/file-drop-utils'
import { colors } from '../../design/tokens'
import { useSettingsStore } from '../../store/settings-store'
import { RenameInput } from './FileContextMenu'
import type { ArtifactType } from '@shared/types'
import type { FlatTreeNode, TreeSortMode } from './buildFileTree'
import {
  FileText,
  FileTs,
  FileJs,
  BracketsCurly,
  FileCss,
  FileHtml,
  FilePdf,
  FileImage,
  FileSvg,
  FileCode,
  GearSix,
  Graph,
  File,
  FolderSimple
} from '@phosphor-icons/react'

/** Indent guide via border-l on the row element.
 *  Simpler than background-image gradients, more native-feeling. */
function indentBorderStyle(depth: number, isActive?: boolean): React.CSSProperties {
  if (depth === 0) return {}
  return {
    borderLeft: `1px solid rgba(255, 255, 255, ${isActive ? '0.12' : '0.06'})`,
    marginLeft: 8 + (depth - 1) * 16 + 7,
    paddingLeft: 9
  }
}

// --- Date grouping helpers (matches collab SourcesFeed pattern) ---

function formatRelativeTime(isoDate?: string): string {
  if (!isoDate) return ''
  const date = new Date(isoDate)
  if (isNaN(date.getTime())) return ''

  const diff = Math.abs(Date.now() - date.getTime())
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (hours < 24) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  }

  const month = date.toLocaleDateString('en-US', { month: 'short' })
  if (days < 365) {
    const day = date.toLocaleDateString('en-US', { day: '2-digit' })
    return `${day} ${month}`
  }
  return `${month} ${date.toLocaleDateString('en-US', { year: 'numeric' })}`
}

function getDateKey(timestamp?: string): string {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  if (isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function formatDateLabel(timestamp?: string): string {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  if (isNaN(date.getTime())) return ''
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const itemDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())

  if (itemDate.getTime() === today.getTime()) return 'Today'
  if (itemDate.getTime() === yesterday.getTime()) return 'Yesterday'
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

interface FileTreeProps {
  nodes: FlatTreeNode[]
  activeFilePath: string | null
  collapsedPaths: Set<string>
  sortMode?: TreeSortMode
  artifactTypes?: Map<string, ArtifactType>
  onCanvasPaths?: ReadonlySet<string>
  canvasConnectionCounts?: ReadonlyMap<string, number>
  onFileSelect: (path: string) => void
  onFileDoubleClick?: (path: string) => void
  onToggleDirectory: (path: string) => void
  onContextMenu?: (e: React.MouseEvent, path: string, isDirectory: boolean) => void
  renamingPath?: string | null
  onRenameConfirm?: (newName: string) => void
  onRenameCancel?: () => void
}

/** Build a path-keyed lookup of directory nodes for O(1) ancestor traversal. */
function buildDirIndex(nodes: FlatTreeNode[]): Map<string, FlatTreeNode> {
  const index = new Map<string, FlatTreeNode>()
  for (const node of nodes) {
    if (node.isDirectory) {
      index.set(node.path, node)
    }
  }
  return index
}

/** Walk up the parentPath chain; return true if no ancestor is collapsed. */
function isVisible(
  node: FlatTreeNode,
  collapsedPaths: Set<string>,
  dirIndex: Map<string, FlatTreeNode>
): boolean {
  let currentParent = node.parentPath

  while (currentParent) {
    const parentNode = dirIndex.get(currentParent)
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

// --- File type icons (Phosphor) ---

type FileIconKind =
  | 'markdown'
  | 'typescript'
  | 'javascript'
  | 'json'
  | 'yaml'
  | 'css'
  | 'html'
  | 'pdf'
  | 'svg'
  | 'image'
  | 'canvas'
  | 'config'
  | 'generic'

const ICON_COLORS: Record<FileIconKind, string> = {
  markdown: '#9badc0',
  typescript: '#4a90e2',
  javascript: '#e8cc44',
  json: '#e0a828',
  yaml: '#e25f42',
  css: '#b07ae8',
  html: '#e06030',
  pdf: '#e04848',
  svg: '#e09838',
  image: '#38d0e8',
  canvas: '#44d4b0',
  config: '#7a8a9a',
  generic: '#7a8a9a'
}

const ICON_COMPONENT: Record<
  FileIconKind,
  React.ComponentType<{ size: number; color: string; weight: 'light' | 'regular' | 'duotone' }>
> = {
  markdown: FileText,
  typescript: FileTs,
  javascript: FileJs,
  json: BracketsCurly,
  yaml: FileCode,
  css: FileCss,
  html: FileHtml,
  pdf: FilePdf,
  svg: FileSvg,
  image: FileImage,
  canvas: Graph,
  config: GearSix,
  generic: File
}

function getFileIconKind(filename: string): FileIconKind {
  const lower = filename.toLowerCase()
  const ext = lower.slice(lower.lastIndexOf('.') + 1)

  if (ext === 'md') return 'markdown'
  if (ext === 'ts' || ext === 'tsx' || ext === 'mts') return 'typescript'
  if (ext === 'js' || ext === 'jsx' || ext === 'mjs' || ext === 'cjs') return 'javascript'
  if (ext === 'json') return 'json'
  if (ext === 'yaml' || ext === 'yml') return 'yaml'
  if (ext === 'css' || ext === 'scss' || ext === 'less') return 'css'
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'svg') return 'svg'
  if (
    ext === 'png' ||
    ext === 'jpg' ||
    ext === 'jpeg' ||
    ext === 'gif' ||
    ext === 'webp' ||
    ext === 'ico'
  )
    return 'image'
  if (ext === 'canvas') return 'canvas'
  if (lower.startsWith('.') || ext === 'toml' || ext === 'lock' || ext === 'env') return 'config'
  return 'generic'
}

function FileIcon({ filename }: { readonly filename: string }) {
  const kind = getFileIconKind(filename)
  const Icon = ICON_COMPONENT[kind]
  return <Icon size={14} color={ICON_COLORS[kind]} weight="duotone" />
}

function FolderIcon() {
  return <FolderSimple size={14} color="#a1a1aa" weight="duotone" />
}

/** Inline SVG chevron pointing right, rotated via CSS when expanded */
function Chevron({ isExpanded }: { isExpanded: boolean }) {
  return (
    <svg
      width="12"
      height="12"
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

export const FileTree = memo(function FileTree({
  nodes,
  activeFilePath,
  collapsedPaths,
  sortMode,
  artifactTypes,
  onCanvasPaths,
  canvasConnectionCounts,
  onFileSelect,
  onFileDoubleClick,
  onToggleDirectory,
  onContextMenu,
  renamingPath,
  onRenameConfirm,
  onRenameCancel
}: FileTreeProps) {
  const dirIndex = useMemo(() => buildDirIndex(nodes), [nodes])
  const visibleNodes = useMemo(
    () => nodes.filter((n) => isVisible(n, collapsedPaths, dirIndex)),
    [nodes, collapsedPaths, dirIndex]
  )

  const settingsFontSize = useSettingsStore((s) => s.env.sidebarFontSize)
  const resolvedFont = 'inherit'
  const showDateHeaders = sortMode === 'modified'

  return (
    <div data-testid="file-tree" className="text-sm select-none px-1 py-1">
      {visibleNodes.map((node, i) => {
        // Insert date separator when sorted by modified and the date bucket changes
        let dateHeader: React.ReactNode = null
        if (showDateHeaders && !node.isDirectory && node.modified) {
          const dateKey = getDateKey(node.modified)
          let needsHeader = true
          for (let j = i - 1; j >= 0; j--) {
            if (!visibleNodes[j].isDirectory && visibleNodes[j].modified) {
              needsHeader = getDateKey(visibleNodes[j].modified) !== dateKey
              break
            }
          }
          if (needsHeader) {
            dateHeader = (
              <div key={`date-${dateKey}`} className="date-separator">
                {formatDateLabel(node.modified)}
              </div>
            )
          }
        }

        return (
          <Fragment key={node.path}>
            {dateHeader}
            {node.isDirectory ? (
              <DirectoryRow
                node={node}
                isCollapsed={collapsedPaths.has(node.path)}
                onToggleDirectory={onToggleDirectory}
                onContextMenu={onContextMenu}
                isRenaming={renamingPath === node.path}
                onRenameConfirm={onRenameConfirm}
                onRenameCancel={onRenameCancel}
                treeFontSize={settingsFontSize}
                treeFontFamily={resolvedFont}
              />
            ) : (
              <FileRow
                node={node}
                isActive={node.path === activeFilePath}
                artifactType={artifactTypes?.get(node.path)}
                isOnCanvas={onCanvasPaths?.has(node.path) ?? false}
                canvasConnectionCount={canvasConnectionCounts?.get(node.path) ?? 0}
                onFileSelect={onFileSelect}
                onFileDoubleClick={onFileDoubleClick}
                onContextMenu={onContextMenu}
                isRenaming={renamingPath === node.path}
                onRenameConfirm={onRenameConfirm}
                onRenameCancel={onRenameCancel}
                treeFontSize={settingsFontSize}
                treeFontFamily={resolvedFont}
              />
            )}
          </Fragment>
        )
      })}
    </div>
  )
})

function DirectoryRow({
  node,
  isCollapsed,
  onToggleDirectory,
  onContextMenu,
  isRenaming,
  onRenameConfirm,
  onRenameCancel,
  treeFontSize,
  treeFontFamily
}: {
  node: FlatTreeNode
  isCollapsed: boolean
  onToggleDirectory: (path: string) => void
  onContextMenu?: (e: React.MouseEvent, path: string, isDirectory: boolean) => void
  isRenaming?: boolean
  onRenameConfirm?: (newName: string) => void
  onRenameCancel?: () => void
  treeFontSize: number
  treeFontFamily: string
}) {
  return (
    <div
      onClick={() => onToggleDirectory(node.path)}
      onContextMenu={(e) => onContextMenu?.(e, node.path, true)}
      className="flex items-center py-[2px] cursor-pointer transition-colors"
      style={{
        paddingLeft: node.depth === 0 ? 8 : undefined,
        paddingRight: 8,
        marginTop: node.depth === 0 ? 6 : undefined,
        color: 'rgba(255, 255, 255, 0.60)',
        fontFamily: treeFontFamily,
        fontWeight: 600,
        fontSize: treeFontSize - 1,
        letterSpacing: '0.02em',
        transition: 'color 120ms ease-out',
        ...indentBorderStyle(node.depth)
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = 'rgba(255, 255, 255, 0.82)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = 'rgba(255, 255, 255, 0.60)'
      }}
    >
      <span className="mr-1 flex items-center" style={{ color: 'rgba(255, 255, 255, 0.30)' }}>
        <Chevron isExpanded={!isCollapsed} />
      </span>
      <span className="mr-1.5 flex items-center shrink-0" style={{ opacity: 0.8 }}>
        <FolderIcon />
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
            color: 'rgba(255, 255, 255, 0.20)',
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
  artifactType: _artifactType,
  isOnCanvas: _isOnCanvas,
  canvasConnectionCount,
  onFileSelect,
  onFileDoubleClick,
  onContextMenu,
  isRenaming,
  onRenameConfirm,
  onRenameCancel,
  treeFontSize,
  treeFontFamily
}: {
  node: FlatTreeNode
  isActive: boolean
  artifactType?: ArtifactType
  isOnCanvas: boolean
  canvasConnectionCount: number
  onFileSelect: (path: string) => void
  onFileDoubleClick?: (path: string) => void
  onContextMenu?: (e: React.MouseEvent, path: string, isDirectory: boolean) => void
  isRenaming?: boolean
  onRenameConfirm?: (newName: string) => void
  onRenameCancel?: () => void
  treeFontSize: number
  treeFontFamily: string
}) {
  const { base, ext } = splitName(node.name)

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
      onDoubleClick={() => (onFileDoubleClick ?? onFileSelect)(node.path)}
      onContextMenu={(e) => onContextMenu?.(e, node.path, false)}
      className="flex items-center py-[2px] cursor-pointer file-row-hover"
      style={{
        paddingLeft: node.depth === 0 ? 24 : undefined,
        paddingRight: 8,
        fontFamily: treeFontFamily,
        fontSize: treeFontSize,
        ...indentBorderStyle(node.depth, isActive)
      }}
      onMouseEnter={(e) => {
        if (node.depth > 0) e.currentTarget.style.borderLeftColor = 'rgba(255, 255, 255, 0.15)'
      }}
      onMouseLeave={(e) => {
        if (node.depth > 0)
          e.currentTarget.style.borderLeftColor = `rgba(255, 255, 255, ${isActive ? '0.12' : '0.06'})`
      }}
    >
      <span className="mr-1.5 flex items-center shrink-0" style={{ opacity: isActive ? 0.9 : 0.7 }}>
        <FileIcon filename={node.name} />
      </span>
      {isRenaming ? (
        <RenameInput
          initialValue={node.name}
          onConfirm={onRenameConfirm ?? (() => {})}
          onCancel={onRenameCancel ?? (() => {})}
        />
      ) : (
        <span className="truncate flex-1 file-name-text" style={{ color: 'rgb(220, 220, 220)' }}>
          {base}
          {ext && <span style={{ opacity: 0.4 }}>{ext}</span>}
        </span>
      )}
      {canvasConnectionCount >= 2 ? (
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
      ) : (
        node.modified && <span className="row-timestamp">{formatRelativeTime(node.modified)}</span>
      )}
    </div>
  )
}
