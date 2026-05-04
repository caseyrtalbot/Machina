import { Fragment, memo, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  TE_FILE_MIME,
  TE_MOVE_MIME,
  inferCardType,
  type DragFileData,
  type DragMoveData
} from '../canvas/file-drop-utils'
import { borderRadius, colors, transitions, typography } from '../../design/tokens'
import { useSettingsStore } from '../../store/settings-store'
import { useSidebarSelectionStore } from '../../store/sidebar-selection-store'
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
function treeGuideColor(emphasis: 'rest' | 'active' = 'rest'): string {
  switch (emphasis) {
    case 'active':
      return 'var(--color-border-default)'
    case 'rest':
    default:
      return 'var(--color-border-subtle)'
  }
}

function indentBorderStyle(depth: number, isActive?: boolean): React.CSSProperties {
  if (depth === 0) return {}
  return {
    borderLeft: `1px solid ${treeGuideColor(isActive ? 'active' : 'rest')}`,
    marginLeft: 8 + (depth - 1) * 16 + 7,
    paddingLeft: 9
  }
}

// --- Date grouping helpers (matches collab SourcesFeed pattern) ---

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

import type { ArtifactOrigin } from './origin-utils'
import { getOriginColor, getFolderOriginColor } from './origin-utils'

interface FileTreeProps {
  nodes: FlatTreeNode[]
  activeFilePath: string | null
  collapsedPaths: Set<string>
  sortMode?: TreeSortMode
  artifactTypes?: Map<string, ArtifactType>
  artifactOrigins?: Map<string, ArtifactOrigin>
  actionedPaths?: ReadonlyMap<string, string>
  onCanvasPaths?: ReadonlySet<string>
  canvasConnectionCounts?: ReadonlyMap<string, number>
  selectedPaths?: ReadonlySet<string>
  agentActive?: boolean
  onFileSelect: (path: string, e?: React.MouseEvent) => void
  onFileDoubleClick?: (path: string) => void
  onToggleDirectory: (path: string) => void
  onContextMenu?: (e: React.MouseEvent, path: string, isDirectory: boolean) => void
  onMoveToFolder?: (sourcePath: string, targetFolderPath: string) => void
  onExternalFileDrop?: (filePaths: readonly string[], targetFolderPath?: string) => void
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
  markdown: '#56b6c2', // teal — primary content type, cool and recognizable
  typescript: '#4a90e2', // blue — traditional TS
  javascript: '#e8cc44', // yellow — traditional JS
  json: '#8bc46a', // leaf green — data format, clearly distinct from JS yellow
  yaml: '#d4768c', // dusty rose — config markup, distinct from html orange
  css: '#b07ae8', // purple — traditional CSS
  html: '#e87040', // orange — traditional HTML
  pdf: '#e04848', // red — documents
  svg: '#e09838', // amber — vector graphics
  image: '#38d0e8', // cyan — raster images
  canvas: '#44d4b0', // mint — graph/canvas
  config: '#7a8a9a', // gray — infrastructure
  generic: '#7a8a9a' // gray — fallback
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

function FileIcon({
  filename,
  origin
}: {
  readonly filename: string
  readonly origin?: ArtifactOrigin
}) {
  const kind = getFileIconKind(filename)
  const Icon = ICON_COMPONENT[kind]
  const color = getOriginColor(origin) ?? ICON_COLORS[kind]
  return <Icon size={14} color={color} weight="duotone" />
}

function FolderIcon({ originColor }: { readonly originColor?: string }) {
  const color = originColor ?? '#a1a1aa'
  return <FolderSimple size={14} color={color} weight="duotone" />
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
        transition: `transform ${transitions.default}`,
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

// ---------------------------------------------------------------------------
// Imperative drag system — zero React state changes during drag = smooth
// ---------------------------------------------------------------------------

interface DragState {
  active: boolean
  sourcePath: string
  sourceIsDir: boolean
  targetPath: string | null
}

const EMPTY_DRAG: DragState = {
  active: false,
  sourcePath: '',
  sourceIsDir: false,
  targetPath: null
}

function clearHighlights(treeEl: HTMLElement) {
  for (const el of treeEl.querySelectorAll('[data-drop-target="true"]')) {
    ;(el as HTMLElement).dataset.dropTarget = 'false'
  }
  for (const el of treeEl.querySelectorAll('[data-dragging="true"]')) {
    ;(el as HTMLElement).dataset.dragging = 'false'
  }
}

// ---------------------------------------------------------------------------

export const FileTree = memo(function FileTree({
  nodes,
  activeFilePath,
  collapsedPaths,
  sortMode,
  artifactTypes,
  artifactOrigins,
  actionedPaths,
  onCanvasPaths,
  canvasConnectionCounts,
  selectedPaths,
  agentActive,
  onFileSelect,
  onFileDoubleClick,
  onToggleDirectory,
  onContextMenu,
  onMoveToFolder,
  onExternalFileDrop,
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
  const resolvedFont = 'var(--font-body)'
  const showDateHeaders = sortMode === 'modified' || sortMode === 'modified-asc'

  // --- Imperative drag management ---
  const treeRef = useRef<HTMLDivElement>(null)
  const drag = useRef<DragState>({ ...EMPTY_DRAG })

  // Stable refs for callbacks used in native event handlers
  const onMoveRef = useRef(onMoveToFolder)
  const onExtDropRef = useRef(onExternalFileDrop)

  // Sync refs with latest callback values
  useEffect(() => {
    onMoveRef.current = onMoveToFolder
  }, [onMoveToFolder])
  useEffect(() => {
    onExtDropRef.current = onExternalFileDrop
  }, [onExternalFileDrop])

  // Tree-level listeners: folder target highlighting + drop acceptance.
  useEffect(() => {
    const tree = treeRef.current
    if (!tree) return

    const handleDragOver = (e: DragEvent) => {
      // --- Intra-vault move ---
      if (drag.current.active) {
        e.preventDefault()
        e.dataTransfer!.dropEffect = 'move'

        const rowEl = (e.target as HTMLElement).closest('[data-node-path]') as HTMLElement | null
        if (!rowEl) return

        const isDir = rowEl.dataset.nodeDir === 'true'
        const targetPath = isDir ? rowEl.dataset.nodePath! : rowEl.dataset.nodeParent!

        if (targetPath !== drag.current.targetPath) {
          // Clear previous highlight
          if (drag.current.targetPath) {
            const prev = tree.querySelector(
              `[data-node-path="${CSS.escape(drag.current.targetPath)}"]`
            ) as HTMLElement | null
            if (prev) prev.dataset.dropTarget = 'false'
          }
          if (isDir) {
            rowEl.dataset.dropTarget = 'true'
          }
          drag.current.targetPath = targetPath
        }
        return
      }

      // --- External file drop from desktop ---
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        tree.dataset.dropActive = 'true'
      }
    }

    const handleDragLeave = (e: DragEvent) => {
      if (tree.contains(e.relatedTarget as Node)) return
      tree.dataset.dropActive = 'false'

      if (drag.current.active && drag.current.targetPath) {
        const prev = tree.querySelector(
          `[data-node-path="${CSS.escape(drag.current.targetPath)}"]`
        ) as HTMLElement | null
        if (prev) prev.dataset.dropTarget = 'false'
        drag.current.targetPath = null
      }
    }

    const handleDrop = (e: DragEvent) => {
      e.preventDefault()
      tree.dataset.dropActive = 'false'

      if (drag.current.active && drag.current.targetPath) {
        const src = drag.current.sourcePath
        const dst = drag.current.targetPath
        // Validate: no self-drop, no drop into own children, no same-parent no-op
        if (src !== dst && !dst.startsWith(src + '/')) {
          const parentOfSource = src.split('/').slice(0, -1).join('/')
          if (parentOfSource !== dst) {
            onMoveRef.current?.(src, dst)
          }
        }
        return
      }

      // External files
      if (e.dataTransfer?.files.length) {
        const paths = Array.from(e.dataTransfer.files)
          .map((f) => (f as File & { path: string }).path)
          .filter(Boolean)
        if (paths.length > 0) {
          const rowEl = (e.target as HTMLElement).closest('[data-node-path]') as HTMLElement | null
          const targetFolder =
            rowEl?.dataset.nodeDir === 'true' ? rowEl.dataset.nodePath : undefined
          onExtDropRef.current?.(paths, targetFolder)
        }
      }
    }

    tree.addEventListener('dragover', handleDragOver)
    tree.addEventListener('dragleave', handleDragLeave)
    tree.addEventListener('drop', handleDrop)
    return () => {
      tree.removeEventListener('dragover', handleDragOver)
      tree.removeEventListener('dragleave', handleDragLeave)
      tree.removeEventListener('drop', handleDrop)
    }
  }, [])

  // Called by individual rows on dragStart
  const handleRowDragStart = useCallback((e: React.DragEvent, node: FlatTreeNode) => {
    const moveData: DragMoveData = { path: node.path, isDirectory: node.isDirectory }
    e.dataTransfer.setData(TE_MOVE_MIME, JSON.stringify(moveData))
    if (!node.isDirectory) {
      const fileData: DragFileData = { path: node.path, type: inferCardType(node.path) }
      e.dataTransfer.setData(TE_FILE_MIME, JSON.stringify(fileData))
    }
    e.dataTransfer.effectAllowed = 'move'
    ;(e.currentTarget as HTMLElement).dataset.dragging = 'true'
    drag.current = {
      active: true,
      sourcePath: node.path,
      sourceIsDir: node.isDirectory,
      targetPath: null
    }
  }, [])

  const handleRowDragEnd = useCallback((e: React.DragEvent) => {
    ;(e.currentTarget as HTMLElement).dataset.dragging = 'false'
    e.currentTarget.removeAttribute('draggable')
    if (treeRef.current) clearHighlights(treeRef.current)
    drag.current = { ...EMPTY_DRAG }
  }, [])

  return (
    <div ref={treeRef} data-testid="file-tree" className="file-tree text-sm select-none px-1 py-1">
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
            // Console section header: muted mono 10px / 0.14em uppercase.
            // Inline override so date headers stay tokenized even though the
            // .date-separator base class lives in the sidebar CSS.
            dateHeader = (
              <div
                key={`date-${dateKey}`}
                className="date-separator"
                style={{
                  color: colors.text.muted,
                  fontFamily: typography.fontFamily.mono,
                  fontSize: typography.metadata.size,
                  letterSpacing: typography.metadata.letterSpacing,
                  textTransform: typography.metadata.textTransform,
                  fontWeight: 600
                }}
              >
                {formatDateLabel(node.modified)}
              </div>
            )
          }
        }

        // Parent folder name for file rows (used by container-level target detection)
        const parentName = !node.isDirectory ? (node.parentPath.split('/').pop() ?? '') : undefined

        return (
          <Fragment key={node.path}>
            {dateHeader}
            {node.isDirectory ? (
              <DirectoryRow
                node={node}
                isCollapsed={collapsedPaths.has(node.path)}
                folderOriginColor={getFolderOriginColor(node.path, artifactOrigins, nodes)}
                onToggleDirectory={onToggleDirectory}
                onContextMenu={onContextMenu}
                onDragStart={handleRowDragStart}
                onDragEnd={handleRowDragEnd}
                isRenaming={renamingPath === node.path}
                onRenameConfirm={onRenameConfirm}
                onRenameCancel={onRenameCancel}
                treeFontSize={settingsFontSize}
                treeFontFamily={resolvedFont}
              />
            ) : (
              <FileRow
                node={node}
                parentName={parentName}
                isActive={node.path === activeFilePath}
                isSelected={selectedPaths?.has(node.path) ?? false}
                isProcessing={(selectedPaths?.has(node.path) ?? false) && (agentActive ?? false)}
                artifactType={artifactTypes?.get(node.path)}
                origin={artifactOrigins?.get(node.path)}
                actionName={actionedPaths?.get(node.path)}
                isOnCanvas={onCanvasPaths?.has(node.path) ?? false}
                canvasConnectionCount={canvasConnectionCounts?.get(node.path) ?? 0}
                onFileSelect={onFileSelect}
                onFileDoubleClick={onFileDoubleClick}
                onContextMenu={onContextMenu}
                onDragStart={handleRowDragStart}
                onDragEnd={handleRowDragEnd}
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
  folderOriginColor,
  onToggleDirectory,
  onContextMenu,
  onDragStart,
  onDragEnd,
  isRenaming,
  onRenameConfirm,
  onRenameCancel,
  treeFontSize,
  treeFontFamily
}: {
  node: FlatTreeNode
  isCollapsed: boolean
  folderOriginColor?: string
  onToggleDirectory: (path: string) => void
  onContextMenu?: (e: React.MouseEvent, path: string, isDirectory: boolean) => void
  onDragStart: (e: React.DragEvent, node: FlatTreeNode) => void
  onDragEnd: (e: React.DragEvent) => void
  isRenaming?: boolean
  onRenameConfirm?: (newName: string) => void
  onRenameCancel?: () => void
  treeFontSize: number
  treeFontFamily: string
}) {
  return (
    <div
      data-node-path={node.path}
      data-node-dir="true"
      data-node-name={node.name}
      onClick={() => onToggleDirectory(node.path)}
      onContextMenu={(e) => onContextMenu?.(e, node.path, true)}
      onMouseDown={(e) => {
        if (e.button === 0) e.currentTarget.setAttribute('draggable', 'true')
      }}
      onDragStart={(e) => onDragStart(e, node)}
      onDragEnd={onDragEnd}
      onMouseUp={(e) => e.currentTarget.removeAttribute('draggable')}
      className="tree-directory-row flex items-center py-[2px] transition-colors"
      // Console: square inline radius, mono icons, primary text. Matches
      // FileRow's left-stripe contract via a transparent border so depth
      // alignment stays pixel-true with active file rows.
      style={{
        paddingLeft: node.depth === 0 ? 4 : undefined,
        paddingRight: 8,
        marginTop: node.depth === 0 ? 6 : undefined,
        color: colors.text.primary,
        fontFamily: treeFontFamily,
        fontWeight: 500,
        fontSize: treeFontSize,
        letterSpacing: '0.02em',
        borderLeft: '2px solid transparent',
        borderRadius: borderRadius.inline,
        ...indentBorderStyle(node.depth)
      }}
    >
      <span className="mr-1 flex items-center" style={{ color: colors.text.muted }}>
        <Chevron isExpanded={!isCollapsed} />
      </span>
      <span className="mr-1.5 flex items-center shrink-0" style={{ opacity: 0.8 }}>
        <FolderIcon originColor={folderOriginColor} />
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
        // Right-aligned item count: console mono 10px in disabled-text gray so
        // the count recedes behind the folder name.
        <span
          className="ml-auto"
          style={{
            color: colors.text.disabled,
            fontFamily: typography.fontFamily.mono,
            fontSize: 10,
            letterSpacing: 0,
            fontVariantNumeric: 'tabular-nums'
          }}
        >
          {node.itemCount}
        </span>
      )}
    </div>
  )
}

/** Action-specific colors for the icon dot indicator */
const ACTION_ICON_COLORS: Record<string, string> = {
  challenge: '#ff847d', // red — stress-testing
  emerge: '#ad9cff', // purple — synthesis
  organize: '#00befa', // sky — grouping
  tidy: '#4ec983', // green — cleanup
  compile: '#dfa11a', // amber — compilation
  librarian: '#60b8d6', // cyan — indexing
  curator: '#4ade80' // green — curation
}

function getActionColor(actionName: string | undefined): string | undefined {
  if (!actionName) return undefined
  return ACTION_ICON_COLORS[actionName]
}

function FileRow({
  node,
  parentName,
  isActive,
  isSelected,
  isProcessing,
  artifactType: _artifactType,
  origin,
  actionName,
  isOnCanvas,
  canvasConnectionCount,
  onFileSelect,
  onFileDoubleClick,
  onContextMenu,
  onDragStart,
  onDragEnd,
  isRenaming,
  onRenameConfirm,
  onRenameCancel,
  treeFontSize,
  treeFontFamily
}: {
  node: FlatTreeNode
  parentName?: string
  isActive: boolean
  isSelected: boolean
  isProcessing: boolean
  artifactType?: ArtifactType
  origin?: ArtifactOrigin
  actionName?: string
  isOnCanvas: boolean
  canvasConnectionCount: number
  onFileSelect: (path: string, e?: React.MouseEvent) => void
  onFileDoubleClick?: (path: string) => void
  onContextMenu?: (e: React.MouseEvent, path: string, isDirectory: boolean) => void
  onDragStart: (e: React.DragEvent, node: FlatTreeNode) => void
  onDragEnd: (e: React.DragEvent) => void
  isRenaming?: boolean
  onRenameConfirm?: (newName: string) => void
  onRenameCancel?: () => void
  treeFontSize: number
  treeFontFamily: string
}) {
  const { base, ext } = splitName(node.name)
  const isAgentModified = useSidebarSelectionStore((s) => s.agentModifiedPaths.has(node.path))
  const actionColor = getActionColor(actionName)

  return (
    <div
      data-node-path={node.path}
      data-node-dir="false"
      data-node-name={node.name}
      data-node-parent={node.parentPath}
      data-node-parent-name={parentName}
      data-active={isActive ? 'true' : 'false'}
      data-selected={isSelected ? 'true' : 'false'}
      data-processing={isProcessing ? 'true' : 'false'}
      onMouseDown={(e) => {
        if (e.button === 0) e.currentTarget.setAttribute('draggable', 'true')
      }}
      onDragStart={(e) => onDragStart(e, node)}
      onDragEnd={onDragEnd}
      onMouseUp={(e) => e.currentTarget.removeAttribute('draggable')}
      onClick={(e) => onFileSelect(node.path, e)}
      onDoubleClick={() => (onFileDoubleClick ?? onFileSelect)(node.path)}
      onContextMenu={(e) => onContextMenu?.(e, node.path, false)}
      className="flex items-center py-[2px] file-row-hover"
      // Console row: 12px text, hairline 2px accent left-stripe when active
      // (transparent on idle so the indent grid stays aligned), 4px paddingLeft
      // for the icon area at depth 0; nested rows pick up indent from
      // indentBorderStyle. Square inline radius.
      style={{
        paddingLeft: node.depth === 0 ? 4 : undefined,
        paddingRight: 8,
        fontFamily: treeFontFamily,
        fontSize: treeFontSize,
        borderLeft: isActive ? `2px solid ${colors.accent.default}` : '2px solid transparent',
        borderRadius: borderRadius.inline,
        ...indentBorderStyle(node.depth, isActive)
      }}
    >
      <span
        className="mr-1.5 flex items-center shrink-0 relative"
        style={{ opacity: isActive ? 1 : isOnCanvas ? 0.8 : actionColor ? 0.9 : 0.5 }}
      >
        <FileIcon filename={node.name} origin={origin} />
        {/* Action color dot — shows which action last touched this file */}
        {actionColor && (
          <span
            style={{
              position: 'absolute',
              bottom: -1,
              left: -2,
              width: 5,
              height: 5,
              borderRadius: '50%',
              backgroundColor: actionColor,
              opacity: 0.9
            }}
          />
        )}
        {isOnCanvas && (
          <span
            style={{
              position: 'absolute',
              top: -1,
              right: -2,
              width: 4,
              height: 4,
              borderRadius: '50%',
              backgroundColor: colors.accent.default,
              opacity: 0.7
            }}
          />
        )}
      </span>
      {isRenaming ? (
        <RenameInput
          initialValue={node.name}
          onConfirm={onRenameConfirm ?? (() => {})}
          onCancel={onRenameCancel ?? (() => {})}
        />
      ) : (
        <span
          className="truncate flex-1 file-name-text"
          style={{
            color: actionColor
              ? actionColor
              : isAgentModified
                ? '#4ade80'
                : isActive
                  ? colors.text.primary
                  : colors.text.primary
          }}
        >
          {base}
          {ext && <span className="file-name-text__ext">{ext}</span>}
        </span>
      )}
      {canvasConnectionCount >= 1 && (
        <span
          className="ml-auto flex-shrink-0"
          style={{
            color: colors.accent.default,
            opacity: 0.6,
            fontSize: 'var(--env-sidebar-tertiary-font-size)',
            fontVariantNumeric: 'tabular-nums'
          }}
        >
          {canvasConnectionCount}
        </span>
      )}
    </div>
  )
}
