import { useState, useCallback } from 'react'

import { rewriteWikilinks } from '@engine/rename-links'
import { useVaultStore } from '../../store/vault-store'
import { colors, getArtifactColor } from '../../design/tokens'
import { FileContextMenu } from './FileContextMenu'
import { FileTree } from './FileTree'
import { SearchBar } from './SearchBar'
import { VaultSelector } from './VaultSelector'
import { WorkspaceFilter } from './WorkspaceFilter'
import type { ArtifactType } from '@shared/types'
import type { SystemArtifactKind } from '@shared/system-artifacts'
import type { FlatTreeNode } from './buildFileTree'
import type { FileContextMenuState } from './FileContextMenu'
import { TagBrowser } from './TagBrowser'

type SortMode = 'modified' | 'name' | 'type'

export interface FileAction {
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
  onCanvasPaths?: ReadonlySet<string>
  canvasConnectionCounts?: ReadonlyMap<string, number>
  sortMode?: SortMode
  vaultName?: string
  vaultHistory?: readonly string[]
  systemArtifacts?: readonly SystemArtifactListItem[]
  onSearch: (query: string) => void
  onWorkspaceSelect: (workspace: string | null) => void
  onFileSelect: (path: string) => void
  onFileDoubleClick?: (path: string) => void
  onSystemArtifactSelect?: (item: SystemArtifactListItem) => void
  onToggleDirectory: (path: string) => void
  onNewFile?: () => void
  onSortChange?: (mode: SortMode) => void
  onFileAction?: (action: FileAction) => void
  onSelectVault?: (path: string) => void
  onOpenVaultPicker?: () => void
  onRemoveFromHistory?: (path: string) => void
  onOpenSettings?: () => void
}

/** Cycle through sort modes on click instead of using a native <select> */
const SORT_CYCLE: SortMode[] = ['modified', 'name', 'type']
const SORT_ICONS: Record<SortMode, string> = {
  modified: 'M12 8H4M10 12H4M8 16H4M16 4H4', // lines descending
  name: 'M4 4h16M4 9h12M4 14h8', // alpha sort
  type: 'M4 4h16M4 9h16M4 14h16' // grouped
}

function ActionBar({
  sortMode = 'modified',
  vaultName,
  vaultHistory = [],
  onNewFile,
  onSortChange,
  onSelectVault,
  onOpenVaultPicker,
  onRemoveFromHistory,
  onOpenSettings
}: {
  sortMode?: SortMode
  vaultName?: string
  vaultHistory?: readonly string[]
  onNewFile?: () => void
  onSortChange?: (mode: SortMode) => void
  onSelectVault?: (path: string) => void
  onOpenVaultPicker?: () => void
  onRemoveFromHistory?: (path: string) => void
  onOpenSettings?: () => void
}) {
  const cycleSortMode = () => {
    const idx = SORT_CYCLE.indexOf(sortMode)
    onSortChange?.(SORT_CYCLE[(idx + 1) % SORT_CYCLE.length])
  }

  return (
    <div className="flex flex-col gap-2 px-3 py-1">
      {/* Vault selector row */}
      <div className="flex items-center">
        {vaultName && onSelectVault && onOpenVaultPicker ? (
          <div className="flex-1 min-w-0">
            <VaultSelector
              currentName={vaultName}
              history={vaultHistory}
              onSelectVault={onSelectVault}
              onOpenPicker={onOpenVaultPicker}
              onRemoveFromHistory={onRemoveFromHistory}
            />
          </div>
        ) : (
          <div className="flex-1" />
        )}
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            className="flex items-center justify-center shrink-0 rounded cursor-pointer"
            style={{ width: 24, height: 24, color: colors.text.muted, opacity: 0.5 }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '1'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '0.5'
            }}
            title="Settings"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 4.754a3.246 3.246 0 100 6.492 3.246 3.246 0 000-6.492zM5.754 8a2.246 2.246 0 114.492 0 2.246 2.246 0 01-4.492 0z" />
              <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 01-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 01-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 01.52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 011.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 011.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 01.52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 01-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 01-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 002.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 001.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 00-1.115 2.693l.16.291c.415.764-.421 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 00-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 00-2.692-1.115l-.292.16c-.764.415-1.6-.421-1.184-1.185l.159-.291A1.873 1.873 0 001.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 003.06 4.377l-.16-.292c-.415-.764.421-1.6 1.185-1.184l.292.159a1.873 1.873 0 002.692-1.115l.094-.319z" />
            </svg>
          </button>
        )}
      </div>
      {/* Section header: Files label with action icons */}
      <div className="flex items-center justify-between">
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.15em',
            color: 'rgba(255, 255, 255, 0.25)'
          }}
        >
          Files
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={onNewFile}
            className="flex items-center justify-center rounded cursor-pointer"
            style={{ width: 22, height: 22, color: colors.text.muted, opacity: 0.5 }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '1'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '0.5'
            }}
            title="New file"
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
            className="flex items-center justify-center rounded cursor-pointer"
            style={{ width: 22, height: 22, color: colors.text.muted, opacity: 0.5 }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '1'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '0.5'
            }}
            title={`Sort: ${sortMode}`}
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
            <div
              className="px-2 pb-1 text-[10px] uppercase tracking-[0.1em]"
              style={{ color: colors.text.muted, opacity: 0.7 }}
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
                    className="flex items-center gap-2 rounded px-2 py-1.5 text-left transition-colors"
                    style={{
                      backgroundColor: isActive ? 'rgba(255, 255, 255, 0.05)' : 'transparent'
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive)
                        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)'
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'
                    }}
                    title={item.path}
                  >
                    <span
                      className="shrink-0 rounded-full"
                      style={{ width: 6, height: 6, backgroundColor: accentColor }}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className="block truncate text-xs"
                        style={{ color: isActive ? colors.text.primary : colors.text.secondary }}
                      >
                        {item.title}
                      </span>
                      {item.status && (
                        <span
                          className="block truncate text-[10px] uppercase tracking-[0.08em]"
                          style={{ color: colors.text.muted }}
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
  onCanvasPaths,
  canvasConnectionCounts,
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
  onSelectVault,
  onOpenVaultPicker,
  onRemoveFromHistory,
  onOpenSettings
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
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-shrink-0">
        <div className="px-3 pt-2 pb-1">
          <SearchBar onSearch={onSearch} />
        </div>
        <ActionBar
          sortMode={sortMode}
          vaultName={vaultName}
          vaultHistory={vaultHistory}
          onNewFile={onNewFile}
          onSortChange={onSortChange}
          onSelectVault={onSelectVault}
          onOpenVaultPicker={onOpenVaultPicker}
          onRemoveFromHistory={onRemoveFromHistory}
          onOpenSettings={onOpenSettings}
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
      <TagBrowser />
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hover">
        <FileTree
          nodes={nodes}
          activeFilePath={activeFilePath}
          collapsedPaths={collapsedPaths}
          artifactTypes={artifactTypes}
          onCanvasPaths={onCanvasPaths}
          canvasConnectionCounts={canvasConnectionCounts}
          onFileSelect={onFileSelect}
          onFileDoubleClick={onFileDoubleClick}
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
