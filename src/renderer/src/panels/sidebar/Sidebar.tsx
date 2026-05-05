import { useState, useCallback } from 'react'

import { rewriteWikilinks } from '@engine/rename-links'
import { useSidebarSelectionStore } from '../../store/sidebar-selection-store'
import { useVaultStore } from '../../store/vault-store'
import {
  borderRadius,
  colors,
  getArtifactColor,
  transitions,
  typography
} from '../../design/tokens'
import { FileContextMenu } from './FileContextMenu'
import { FileTree } from './FileTree'
import { SearchBar } from './SearchBar'
import { VaultSelector } from './VaultSelector'
import { WorkspaceFilter } from './WorkspaceFilter'
import type { ArtifactType } from '@shared/types'
import type { ArtifactOrigin } from './origin-utils'
import type { SystemArtifactKind } from '@shared/system-artifacts'
import type { FlatTreeNode } from './buildFileTree'
import type { FileContextMenuState } from './FileContextMenu'
import { useUiStore } from '../../store/ui-store'
import { TagBrowser } from './TagBrowser'
import { DailyNoteSection } from './DailyNoteSection'
import { BookmarksList } from './BookmarksList'

type SortMode = 'modified' | 'modified-asc' | 'name' | 'name-desc' | 'type'

interface FileAction {
  readonly actionId: string
  readonly path: string
  readonly isDirectory: boolean
}

export interface SystemArtifactListItem {
  readonly id: string
  readonly path: string
  readonly title: string
  readonly type: SystemArtifactKind
  readonly modified: string
  readonly status?: string
}

interface SidebarProps {
  nodes: FlatTreeNode[]
  workspaces: string[]
  activeWorkspace: string | null
  activeFilePath: string | null
  collapsedPaths: Set<string>
  artifactTypes?: Map<string, ArtifactType>
  artifactOrigins?: Map<string, ArtifactOrigin>
  onCanvasPaths?: ReadonlySet<string>
  canvasConnectionCounts?: ReadonlyMap<string, number>
  sortMode?: SortMode
  vaultName?: string
  vaultHistory?: readonly string[]
  systemArtifacts?: readonly SystemArtifactListItem[]
  onSearch: (query: string) => void
  onWorkspaceSelect: (workspace: string | null) => void
  selectedPaths?: ReadonlySet<string>
  agentActive?: boolean
  onFileSelect: (path: string, e?: React.MouseEvent) => void
  onFileDoubleClick?: (path: string) => void
  onSystemArtifactSelect?: (item: SystemArtifactListItem) => void
  onToggleDirectory: (path: string) => void
  onNewFile?: () => void
  onSortChange?: (mode: SortMode) => void
  onFileAction?: (action: FileAction) => void
  onMoveToFolder?: (sourcePath: string, targetFolderPath: string) => void
  onExternalFileDrop?: (filePaths: readonly string[], targetFolderPath?: string) => void
  onSelectVault?: (path: string) => void
  onOpenVaultPicker?: () => void
  onRemoveFromHistory?: (path: string) => void
  onOpenSettings?: () => void
  onOpenDailyNote?: (dateStr: string) => void
}

/** Cycle through sort modes on click instead of using a native <select> */
const SORT_CYCLE: SortMode[] = ['modified', 'modified-asc', 'name', 'name-desc', 'type']
const SORT_ICONS: Record<SortMode, string> = {
  modified: 'M12 8H4M10 12H4M8 16H4M16 4H4', // newest first
  'modified-asc': 'M8 8H4M10 12H4M12 16H4M16 4H4', // oldest first
  name: 'M4 4h16M4 9h12M4 14h8', // A-Z
  'name-desc': 'M4 4h8M4 9h12M4 14h16', // Z-A
  type: 'M4 4h16M4 9h16M4 14h16' // grouped
}
const SORT_LABELS: Record<SortMode, string> = {
  modified: 'Modified (newest)',
  'modified-asc': 'Modified (oldest)',
  name: 'Name A\u2013Z',
  'name-desc': 'Name Z\u2013A',
  type: 'Type'
}

function ActionBar({
  sortMode = 'modified',
  vaultName,
  vaultHistory = [],
  fileCount = 0,
  filesCollapsed = false,
  onNewFile,
  onSortChange,
  onSelectVault,
  onOpenVaultPicker,
  onRemoveFromHistory,
  onOpenSettings: _onOpenSettings,
  onToggleFiles
}: {
  sortMode?: SortMode
  vaultName?: string
  vaultHistory?: readonly string[]
  fileCount?: number
  filesCollapsed?: boolean
  onNewFile?: () => void
  onSortChange?: (mode: SortMode) => void
  onSelectVault?: (path: string) => void
  onOpenVaultPicker?: () => void
  onRemoveFromHistory?: (path: string) => void
  onOpenSettings?: () => void
  onToggleFiles?: () => void
}) {
  const cycleSortMode = () => {
    const idx = SORT_CYCLE.indexOf(sortMode)
    onSortChange?.(SORT_CYCLE[(idx + 1) % SORT_CYCLE.length])
  }

  return (
    <div className="sidebar-action-bar">
      <div className="sidebar-section-bar">
        <div className="sidebar-section-bar-left">
          {vaultName && onSelectVault && onOpenVaultPicker ? (
            <VaultSelector
              currentName={vaultName}
              currentPath={useVaultStore.getState().vaultPath}
              history={vaultHistory}
              onSelectVault={onSelectVault}
              onOpenPicker={onOpenVaultPicker}
              onRemoveFromHistory={onRemoveFromHistory}
            />
          ) : null}
          <span aria-hidden className="sidebar-section-bar-divider" />
          <button onClick={() => onToggleFiles?.()} className="sidebar-section-toggle">
            <svg
              width="10"
              height="10"
              viewBox="0 0 16 16"
              fill="none"
              style={{
                transform: filesCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                transition: `transform ${transitions.default}`,
                color: colors.text.muted
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
            <span className="sidebar-section-copy">
              {/* Console section header: muted mono 10px / 0.14em uppercase. */}
              <span
                className="sidebar-section-label"
                style={{
                  color: colors.text.muted,
                  fontFamily: typography.fontFamily.mono,
                  fontSize: typography.metadata.size,
                  letterSpacing: typography.metadata.letterSpacing,
                  textTransform: typography.metadata.textTransform,
                  fontWeight: 600
                }}
              >
                Files
              </span>
              {/* Right-aligned count in disabled-text gray, recedes behind the
                section label. */}
              <span
                className="sidebar-section-count"
                style={{
                  color: colors.text.disabled,
                  fontFamily: typography.fontFamily.mono,
                  fontSize: typography.metadata.size,
                  letterSpacing: typography.metadata.letterSpacing,
                  fontVariantNumeric: 'tabular-nums'
                }}
              >
                {fileCount}
              </span>
            </span>
          </button>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={onNewFile}
            className="sidebar-icon-button"
            // Console icon button: 24×24, square inline radius, muted icon
            // color. Background lift on hover lives in the CSS class.
            style={{
              color: colors.text.muted,
              width: 24,
              height: 24,
              borderRadius: borderRadius.inline
            }}
            title="New file"
            aria-label="New file"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <line x1="6" y1="2" x2="6" y2="10" />
              <line x1="2" y1="6" x2="10" y2="6" />
            </svg>
          </button>
          <button
            onClick={cycleSortMode}
            className="sidebar-icon-button"
            style={{
              color: colors.text.muted,
              width: 24,
              height: 24,
              borderRadius: borderRadius.inline
            }}
            title={`Sort: ${SORT_LABELS[sortMode]}`}
            aria-label={`Sort: ${SORT_LABELS[sortMode]}. Click to cycle.`}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d={SORT_ICONS[sortMode]} />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

function prettyKind(kind: SystemArtifactKind): string {
  switch (kind) {
    case 'session':
      return 'Sessions'
    case 'pattern':
      return 'Patterns'
    case 'tension':
      return 'Tensions'
  }
}

function SystemArtifactCollections({
  items = [],
  activeFilePath,
  onSelect
}: {
  items?: readonly SystemArtifactListItem[]
  activeFilePath: string | null
  onSelect?: (item: SystemArtifactListItem) => void
}) {
  if (items.length === 0) return null

  const grouped = {
    session: items.filter((item) => item.type === 'session'),
    pattern: items.filter((item) => item.type === 'pattern'),
    tension: items.filter((item) => item.type === 'tension')
  } as const

  return (
    <div className="px-2 py-2">
      {(Object.keys(grouped) as SystemArtifactKind[]).map((kind) => {
        const kindItems = grouped[kind]
        if (kindItems.length === 0) return null

        return (
          <div key={kind} className="mb-3 last:mb-0">
            {/* Console section header: muted mono 10px / 0.14em uppercase. */}
            <div
              className="px-2 pb-2 sidebar-section-label"
              style={{
                color: colors.text.muted,
                fontFamily: typography.fontFamily.mono,
                fontSize: typography.metadata.size,
                letterSpacing: typography.metadata.letterSpacing,
                textTransform: typography.metadata.textTransform,
                fontWeight: 600
              }}
            >
              {prettyKind(kind)}
            </div>
            <div className="flex flex-col gap-0.5">
              {kindItems.map((item) => {
                const isActive = activeFilePath === item.path
                const accentColor = getArtifactColor(item.type)

                return (
                  <button
                    key={item.id}
                    onClick={() => onSelect?.(item)}
                    className="file-row-hover flex items-center gap-2 px-2 py-1.5 text-left transition-colors"
                    data-active={isActive ? 'true' : 'false'}
                    title={item.path}
                    // Console row: 2px accent left-stripe when active so this
                    // matches FileTree/Bookmarks treatment.
                    style={{
                      borderLeft: `2px solid ${isActive ? colors.accent.default : 'transparent'}`,
                      borderRadius: borderRadius.inline
                    }}
                  >
                    <span
                      className="shrink-0 rounded-full"
                      style={{ width: 6, height: 6, backgroundColor: accentColor }}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className="block truncate"
                        style={{
                          color: isActive ? colors.text.primary : colors.text.secondary,
                          fontSize: 'var(--env-sidebar-font-size)'
                        }}
                      >
                        {item.title}
                      </span>
                      {item.status && (
                        <span
                          className="block truncate uppercase tracking-[0.08em]"
                          style={{
                            color: colors.text.muted,
                            fontSize: 'var(--env-sidebar-tertiary-font-size)'
                          }}
                        >
                          {item.status}
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
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
  artifactOrigins,
  onCanvasPaths,
  canvasConnectionCounts,
  selectedPaths,
  agentActive,
  sortMode = 'modified',
  vaultName,
  vaultHistory,
  systemArtifacts,
  onSearch,
  onWorkspaceSelect,
  onFileSelect,
  onFileDoubleClick,
  onSystemArtifactSelect,
  onToggleDirectory,
  onNewFile,
  onSortChange,
  onFileAction,
  onMoveToFolder,
  onExternalFileDrop,
  onSelectVault,
  onOpenVaultPicker,
  onRemoveFromHistory,
  onOpenSettings,
  onOpenDailyNote
}: SidebarProps) {
  const [contextMenu, setContextMenu] = useState<FileContextMenuState | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [filesCollapsed, setFilesCollapsed] = useState(false)
  const fileCount = nodes.filter((node) => !node.isDirectory).length
  const actionedPaths = useSidebarSelectionStore((s) => s.actionedPaths)

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
      if (actionId === 'mark-reviewed') {
        useSidebarSelectionStore.getState().clearAgentModified(path)
        return
      }
      if (actionId === 'toggle-bookmark') {
        useUiStore.getState().toggleBookmark(path)
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

      // Capture backlinks before rename (index still has old stem)
      const oldBasename = renamingPath.split('/').pop() ?? ''
      const oldStem = oldBasename.replace(/\.md$/i, '')
      const newStem = newName.replace(/\.md$/i, '')
      const { fileToId, getBacklinks, artifactPathById } = useVaultStore.getState()
      const oldId = fileToId[renamingPath]
      // Only rewrite if the id was derived from filename (no explicit id override)
      const needsRewrite = !isDirectory && oldId === oldStem && oldStem !== newStem
      const backlinks = needsRewrite ? getBacklinks(oldStem) : []
      const pathMap = { ...artifactPathById }

      window.api.fs
        .renameFile(renamingPath, newPath)
        .then(async () => {
          if (needsRewrite) {
            await Promise.all(
              backlinks.map(async (artifact) => {
                const filePath = pathMap[artifact.id]
                if (!filePath || filePath === renamingPath) return
                const raw = await window.api.fs.readFile(filePath)
                const updated = rewriteWikilinks(raw, oldStem, newStem)
                if (updated !== raw) await window.api.fs.writeFile(filePath, updated)
              })
            )
          }
          setRenamingPath(null)
        })
        .catch(() => setRenamingPath(null))
    },
    [renamingPath, nodes, onFileAction]
  )

  return (
    <div className="workspace-sidebar-shell">
      <div className="sidebar-top-stack flex-shrink-0">
        <SearchBar onSearch={onSearch} />
        <ActionBar
          sortMode={sortMode}
          vaultName={vaultName}
          vaultHistory={vaultHistory}
          fileCount={fileCount}
          filesCollapsed={filesCollapsed}
          onNewFile={onNewFile}
          onSortChange={onSortChange}
          onSelectVault={onSelectVault}
          onOpenVaultPicker={onOpenVaultPicker}
          onRemoveFromHistory={onRemoveFromHistory}
          onOpenSettings={onOpenSettings}
          onToggleFiles={() => setFilesCollapsed((prev) => !prev)}
        />
        {workspaces.length > 0 && (
          <WorkspaceFilter
            workspaces={workspaces}
            active={activeWorkspace}
            onSelect={onWorkspaceSelect}
          />
        )}
      </div>
      <div className="flex-shrink-0">
        <SystemArtifactCollections
          items={systemArtifacts}
          activeFilePath={activeFilePath}
          onSelect={onSystemArtifactSelect}
        />
      </div>
      {onOpenDailyNote && (
        <DailyNoteSection
          onOpenDate={onOpenDailyNote}
          activeFilePath={activeFilePath}
          onFileSelect={onFileSelect}
          onContextMenu={handleContextMenu}
        />
      )}
      <BookmarksList activeFilePath={activeFilePath} onFileSelect={onFileSelect} />
      {!filesCollapsed && (
        <>
          <TagBrowser />
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hover">
            <FileTree
              nodes={nodes}
              activeFilePath={activeFilePath}
              collapsedPaths={collapsedPaths}
              sortMode={sortMode}
              artifactTypes={artifactTypes}
              artifactOrigins={artifactOrigins}
              actionedPaths={actionedPaths}
              onCanvasPaths={onCanvasPaths}
              canvasConnectionCounts={canvasConnectionCounts}
              selectedPaths={selectedPaths}
              agentActive={agentActive}
              onFileSelect={onFileSelect}
              onFileDoubleClick={onFileDoubleClick}
              onToggleDirectory={onToggleDirectory}
              onContextMenu={handleContextMenu}
              onMoveToFolder={onMoveToFolder}
              onExternalFileDrop={onExternalFileDrop}
              renamingPath={renamingPath}
              onRenameConfirm={handleRenameConfirm}
              onRenameCancel={() => setRenamingPath(null)}
            />
          </div>
        </>
      )}

      <FileContextMenu
        state={contextMenu}
        onClose={() => setContextMenu(null)}
        onAction={handleContextMenuAction}
      />
    </div>
  )
}
