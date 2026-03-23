import { memo, useMemo } from 'react'
import { TE_FILE_MIME, inferCardType, type DragFileData } from '../canvas/file-drop-utils'
import { colors } from '../../design/tokens'
import { useSettingsStore } from '../../store/settings-store'
import { buildFontFamilyValue } from '../../design/google-fonts'
import { RenameInput } from './FileContextMenu'
import type { ArtifactType } from '@shared/types'
import type { FlatTreeNode } from './buildFileTree'
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

/** Generate CSS background-image with vertical indent guide lines.
 *  Each line is a 1px-wide gradient column at the indent position.
 *  Because it's a background on the row itself, lines connect seamlessly
 *  between adjacent rows with no gap. */
function indentGuideBackground(depth: number): React.CSSProperties {
  if (depth === 0) return {}
  const guides: string[] = []
  const positions: string[] = []
  for (let i = 0; i < depth; i++) {
    const x = 8 + i * 16 + 7
    guides.push('linear-gradient(rgba(255,255,255,0.06), rgba(255,255,255,0.06))')
    positions.push(`${x}px 0`)
  }
  return {
    backgroundImage: guides.join(', '),
    backgroundPosition: positions.join(', '),
    backgroundSize: guides.map(() => '1px 100%').join(', '),
    backgroundRepeat: 'no-repeat'
  }
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
      className="flex items-center py-[5px] cursor-pointer rounded transition-colors"
      style={{
        paddingLeft,
        paddingRight: 8,
        marginTop: node.depth === 0 ? 6 : undefined,
        color: '#a0a0a0',
        fontFamily: treeFontFamily,
        fontWeight: 600,
        fontSize: treeFontSize - 1,
        letterSpacing: '0.02em',
        ...indentGuideBackground(node.depth)
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = ''
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
            color: '#6a6a6a',
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
  const paddingLeft = 8 + node.depth * 16 + 16
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
      className="flex items-center py-[5px] cursor-pointer rounded transition-colors"
      style={{
        paddingLeft,
        paddingRight: 8,
        backgroundColor: isActive ? 'rgba(255, 255, 255, 0.06)' : undefined,
        borderLeft: isActive ? `2px solid ${colors.accent.default}` : '2px solid transparent',
        fontFamily: treeFontFamily,
        fontWeight: 400,
        fontSize: treeFontSize,
        ...indentGuideBackground(node.depth)
      }}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)'
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.backgroundColor = ''
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
        <span className="truncate flex-1">
          <span style={{ color: isActive ? colors.text.primary : '#8c8c8c' }}>{base}</span>
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
