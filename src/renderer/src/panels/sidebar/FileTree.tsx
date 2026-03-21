import { memo, useMemo } from 'react'
import { TE_FILE_MIME, inferCardType, type DragFileData } from '../canvas/file-drop-utils'
import { colors } from '../../design/tokens'
import { useSettingsStore } from '../../store/settings-store'
import { buildFontFamilyValue } from '../../design/google-fonts'
import { RenameInput } from './FileContextMenu'
import type { ArtifactType } from '@shared/types'
import type { FlatTreeNode } from './buildFileTree'

/** Vertical indent guide lines connecting parent directories to children. */
function TreeGuides({ depth }: { readonly depth: number }) {
  if (depth === 0) return null
  return (
    <>
      {Array.from({ length: depth }, (_, i) => (
        <span
          key={i}
          className="absolute top-0 bottom-0 pointer-events-none"
          style={{
            left: 8 + i * 16 + 7,
            width: 1,
            backgroundColor: 'rgba(255, 255, 255, 0.06)'
          }}
        />
      ))}
    </>
  )
}

export interface FileTreeProps {
  nodes: FlatTreeNode[]
  activeFilePath: string | null
  collapsedPaths: Set<string>
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

// --- File type icons ---

type FileIconKind =
  | 'markdown'
  | 'typescript'
  | 'javascript'
  | 'json'
  | 'yaml'
  | 'css'
  | 'html'
  | 'image'
  | 'canvas'
  | 'config'
  | 'generic'

const ICON_COLORS: Record<FileIconKind, string> = {
  markdown: '#94a3b8',
  typescript: '#3178c6',
  javascript: '#f7df1e',
  json: '#e6a817',
  yaml: '#cb4a32',
  css: '#a855f7',
  html: '#e34f26',
  image: '#22d3ee',
  canvas: '#34d399',
  config: '#64748b',
  generic: '#64748b'
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
  if (
    ext === 'png' ||
    ext === 'jpg' ||
    ext === 'jpeg' ||
    ext === 'svg' ||
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
  const color = ICON_COLORS[kind]

  // All icons are 14x14 inline SVGs
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 16 16',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg'
  }
  const stroke = {
    stroke: color,
    strokeWidth: '1.5',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const
  }

  switch (kind) {
    case 'markdown':
      return (
        <svg {...common}>
          <rect x="2" y="1.5" width="12" height="13" rx="1.5" {...stroke} />
          <path d="M5 10V6l2 2.5L9 6v4" {...stroke} />
          <path d="M11 8.5V10" {...stroke} />
          <path d="M11 7V7.01" {...stroke} strokeWidth="2" />
        </svg>
      )
    case 'typescript':
      return (
        <svg {...common}>
          <rect x="2" y="1.5" width="12" height="13" rx="1.5" {...stroke} />
          <path d="M5.5 6.5h3M7 6.5v4.5" {...stroke} />
          <path
            d="M10 6.5c1.2 0 1.5.7 1.5 1.2s-.3 1.3-1.5 1.3c1.2 0 1.5.7 1.5 1.3s-.3 1.2-1.5 1.2"
            {...stroke}
          />
        </svg>
      )
    case 'javascript':
      return (
        <svg {...common}>
          <rect x="2" y="1.5" width="12" height="13" rx="1.5" {...stroke} />
          <path d="M7 6.5v3.5c0 .8-.5 1-1 1" {...stroke} />
          <path
            d="M10 6.5c1.2 0 1.5.7 1.5 1.2s-.3 1.3-1.5 1.3c1.2 0 1.5.7 1.5 1.3s-.3 1.2-1.5 1.2"
            {...stroke}
          />
        </svg>
      )
    case 'json':
      return (
        <svg {...common}>
          <rect x="2" y="1.5" width="12" height="13" rx="1.5" {...stroke} />
          <path d="M6 5c-1.5 0-1.5 1.5-1.5 3s0 3 1.5 3" {...stroke} />
          <path d="M10 5c1.5 0 1.5 1.5 1.5 3s0 3-1.5 3" {...stroke} />
        </svg>
      )
    case 'yaml':
      return (
        <svg {...common}>
          <rect x="2" y="1.5" width="12" height="13" rx="1.5" {...stroke} />
          <path d="M5.5 5.5L8 8.5 10.5 5.5" {...stroke} />
          <path d="M8 8.5V11.5" {...stroke} />
        </svg>
      )
    case 'css':
      return (
        <svg {...common}>
          <rect x="2" y="1.5" width="12" height="13" rx="1.5" {...stroke} />
          <path d="M6 6l-1.5 2.5L6 11" {...stroke} />
          <path d="M10 6l1.5 2.5L10 11" {...stroke} />
        </svg>
      )
    case 'html':
      return (
        <svg {...common}>
          <rect x="2" y="1.5" width="12" height="13" rx="1.5" {...stroke} />
          <path d="M5.5 6l-2 2.5 2 2.5" {...stroke} />
          <path d="M10.5 6l2 2.5-2 2.5" {...stroke} />
          <path d="M9 5.5L7 11.5" {...stroke} />
        </svg>
      )
    case 'image':
      return (
        <svg {...common}>
          <rect x="2" y="1.5" width="12" height="13" rx="1.5" {...stroke} />
          <circle cx="6" cy="5.5" r="1.5" {...stroke} />
          <path d="M2.5 11l3-3.5 2 2 2-1.5L14 12" {...stroke} />
        </svg>
      )
    case 'canvas':
      return (
        <svg {...common}>
          <rect x="2" y="1.5" width="12" height="13" rx="1.5" {...stroke} />
          <rect x="4" y="4" width="3" height="2.5" rx="0.5" {...stroke} />
          <rect x="9" y="9" width="3" height="2.5" rx="0.5" {...stroke} />
          <path d="M7 5.25L9 10.25" {...stroke} strokeDasharray="1.5 1.5" />
        </svg>
      )
    case 'config':
      return (
        <svg {...common}>
          <rect x="2" y="1.5" width="12" height="13" rx="1.5" {...stroke} />
          <circle cx="8" cy="8" r="2" {...stroke} />
          <path d="M8 4v2M8 10v2M4 8h2M10 8h2" {...stroke} />
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <path
            d="M4 1.5h5.5L13 5v8.5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13.5V3A1.5 1.5 0 0 1 4 1.5z"
            {...stroke}
          />
          <path d="M9.5 1.5V5H13" {...stroke} />
        </svg>
      )
  }
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

export const FileTree = memo(function FileTree({
  nodes,
  activeFilePath,
  collapsedPaths,
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

  const settingsFontSize = useSettingsStore((s) => s.fontSize)
  const settingsFontFamily = useSettingsStore((s) => s.fontFamily)
  const resolvedFont = buildFontFamilyValue(settingsFontFamily)

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
            treeFontSize={settingsFontSize}
            treeFontFamily={resolvedFont}
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
            onFileDoubleClick={onFileDoubleClick}
            onContextMenu={onContextMenu}
            isRenaming={renamingPath === node.path}
            onRenameConfirm={onRenameConfirm}
            onRenameCancel={onRenameCancel}
            treeFontSize={settingsFontSize}
            treeFontFamily={resolvedFont}
          />
        )
      )}
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
  const paddingLeft = 8 + node.depth * 16

  return (
    <div
      onClick={() => onToggleDirectory(node.path)}
      onContextMenu={(e) => onContextMenu?.(e, node.path, true)}
      className="relative flex items-center py-0.5 cursor-pointer rounded transition-colors"
      style={{
        paddingLeft,
        paddingRight: 8,
        marginBottom: 1,
        color: colors.text.primary,
        fontFamily: treeFontFamily,
        fontWeight: 400,
        fontSize: treeFontSize - 1,
        textTransform: 'uppercase',
        letterSpacing: '0.04em'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = ''
      }}
    >
      <TreeGuides depth={node.depth} />
      <span className="mr-1.5 flex items-center" style={{ color: colors.text.muted }}>
        <Chevron isExpanded={!isCollapsed} />
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
  const paddingLeft = 8 + node.depth * 16 + 4
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
      className="relative flex items-center py-0.5 cursor-pointer rounded transition-colors"
      style={{
        paddingLeft,
        paddingRight: 8,
        marginBottom: 1,
        backgroundColor: isActive ? 'rgba(255, 255, 255, 0.10)' : undefined,
        borderLeft: isActive ? `2px solid ${colors.accent.default}` : '2px solid transparent',
        fontFamily: treeFontFamily,
        fontWeight: 400,
        fontSize: treeFontSize
      }}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)'
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.backgroundColor = ''
      }}
    >
      <TreeGuides depth={node.depth} />
      <span className="mr-1.5 flex items-center shrink-0" style={{ opacity: 0.8 }}>
        <FileIcon filename={node.name} />
      </span>
      {isRenaming ? (
        <RenameInput
          initialValue={node.name}
          onConfirm={onRenameConfirm ?? (() => {})}
          onCancel={onRenameCancel ?? (() => {})}
        />
      ) : (
        <span className="truncate flex-1">
          <span style={{ color: colors.text.primary }}>{base}</span>
          {ext && <span style={{ color: colors.text.muted }}>{ext}</span>}
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
