import { PanelHeader } from '../../components/panelheader/PanelHeader'
import { useMemo, useRef, useState } from 'react'
import { useThreadStore } from '../../store/thread-store'
import { useVaultStore } from '../../store/vault-store'
import { ContextMenu, type ContextMenuPosition } from '../../components/ContextMenu'
import { AgentPicker } from './AgentPicker'
import { AgentBadge } from './agent-badge'
import type { AgentIdentity } from '@shared/agent-identity'
import type { Thread } from '@shared/thread-types'
import { DEFAULT_NATIVE_MODEL } from '@shared/machina-native-tools'
import { Bot } from 'lucide-react'

interface ThreadSidebarProps {
  readonly width?: number
  readonly onChangeVault?: () => void
  readonly onOpenHarnessGallery?: () => void
}

interface MenuTarget {
  readonly threadId: string
  readonly position: ContextMenuPosition
  /** True when the menu targets a row in the Archived section. */
  readonly archived: boolean
}

export function ThreadSidebar({
  width = 240,
  onChangeVault,
  onOpenHarnessGallery
}: ThreadSidebarProps = {}) {
  const threadsById = useThreadStore((s) => s.threadsById)
  const activeId = useThreadStore((s) => s.activeThreadId)
  const selectThread = useThreadStore((s) => s.selectThread)
  const createThread = useThreadStore((s) => s.createThread)
  const archiveThread = useThreadStore((s) => s.archiveThread)
  const deleteThread = useThreadStore((s) => s.deleteThread)
  const renameThread = useThreadStore((s) => s.renameThread)
  const archivedThreads = useThreadStore((s) => s.archivedThreads)
  const loadArchivedThreads = useThreadStore((s) => s.loadArchivedThreads)
  const unarchiveThread = useThreadStore((s) => s.unarchiveThread)
  const deleteArchivedThread = useThreadStore((s) => s.deleteArchivedThread)
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const vaultName = vaultPath?.split('/').pop() || 'Vault'

  const sorted = useMemo(
    () => Object.values(threadsById).sort((a, b) => b.lastMessage.localeCompare(a.lastMessage)),
    [threadsById]
  )

  const [pickerOpen, setPickerOpen] = useState(false)
  const [menu, setMenu] = useState<MenuTarget | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [archivedOpen, setArchivedOpen] = useState(false)

  function openMenuAt(threadId: string, x: number, y: number, archived = false) {
    setMenu({ threadId, position: { x, y }, archived })
  }

  function toggleArchived() {
    const next = !archivedOpen
    setArchivedOpen(next)
    // Lazy fetch: the archive can be large and is rarely opened.
    if (next) void loadArchivedThreads()
  }

  function startRename(id: string) {
    setRenaming(id)
  }

  function commitRename(id: string, value: string) {
    setRenaming(null)
    void renameThread(id, value)
  }

  return (
    <aside className="te-thread-sidebar" style={{ width }}>
      <PanelHeader flush>
        <VaultSwitcher
          name={vaultPath ? vaultName : 'Open vault…'}
          fullPath={vaultPath ?? null}
          onClick={onChangeVault}
        />
      </PanelHeader>
      <div className="te-thread-sidebar__list-scroll">
        <ul className="te-thread-list">
          {sorted.map((t) => (
            <ThreadRow
              key={t.id}
              id={t.id}
              title={t.title}
              agent={t.agent}
              isActive={activeId === t.id}
              isRenaming={renaming === t.id}
              onSelect={() => void selectThread(t.id)}
              onContextMenu={(x, y) => openMenuAt(t.id, x, y)}
              onCommitRename={(value) => commitRename(t.id, value)}
              onCancelRename={() => setRenaming(null)}
            />
          ))}
        </ul>
        <ArchivedSection
          open={archivedOpen}
          threads={archivedThreads}
          onToggle={toggleArchived}
          onContextMenu={(id, x, y) => openMenuAt(id, x, y, true)}
        />
      </div>
      <footer className="te-thread-sidebar__footer">
        {pickerOpen && vaultPath ? (
          <AgentPicker
            onPick={(a) => {
              setPickerOpen(false)
              void createThread(a, DEFAULT_NATIVE_MODEL)
            }}
            onCancel={() => setPickerOpen(false)}
          />
        ) : (
          <div className="te-thread-sidebar__actions">
            <NewThreadButton disabled={!vaultPath} onClick={() => setPickerOpen(true)} />
            <NewAgentButton
              disabled={!vaultPath || !onOpenHarnessGallery}
              onClick={() => onOpenHarnessGallery?.()}
            />
          </div>
        )}
      </footer>
      {menu && (
        <ContextMenu
          position={menu.position}
          onClose={() => setMenu(null)}
          items={
            menu.archived
              ? [
                  {
                    id: 'unarchive',
                    label: 'Unarchive',
                    onSelect: () => void unarchiveThread(menu.threadId)
                  },
                  {
                    id: 'delete',
                    label: 'Delete',
                    destructive: true,
                    onSelect: () => void deleteArchivedThread(menu.threadId)
                  }
                ]
              : [
                  {
                    id: 'rename',
                    label: 'Rename',
                    onSelect: () => startRename(menu.threadId)
                  },
                  {
                    id: 'archive',
                    label: 'Archive',
                    onSelect: () => void archiveThread(menu.threadId)
                  },
                  {
                    id: 'delete',
                    label: 'Delete',
                    destructive: true,
                    onSelect: () => void deleteThread(menu.threadId)
                  }
                ]
          }
        />
      )}
    </aside>
  )
}

function ArchivedSection({
  open,
  threads,
  onToggle,
  onContextMenu
}: {
  readonly open: boolean
  readonly threads: readonly Thread[]
  readonly onToggle: () => void
  readonly onContextMenu: (threadId: string, x: number, y: number) => void
}) {
  return (
    <section className="te-thread-archived">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        data-testid="archived-section-toggle"
        className="te-thread-archived__toggle"
      >
        <span aria-hidden className="te-thread-archived__caret">
          ▶
        </span>
        Archived{open ? ` (${threads.length})` : ''}
      </button>
      {open && (
        <ul className="te-thread-list">
          {threads.length === 0 ? (
            <li className="te-thread-archived__empty">No archived threads</li>
          ) : (
            threads.map((t) => (
              <ArchivedRow
                key={t.id}
                id={t.id}
                title={t.title}
                agent={t.agent}
                onContextMenu={(x, y) => onContextMenu(t.id, x, y)}
              />
            ))
          )}
        </ul>
      )}
    </section>
  )
}

function ArchivedRow({
  id,
  title,
  agent,
  onContextMenu
}: {
  readonly id: string
  readonly title: string
  readonly agent: AgentIdentity
  readonly onContextMenu: (x: number, y: number) => void
}) {
  const kebabRef = useRef<HTMLButtonElement | null>(null)

  function handleKebab(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation()
    const rect = kebabRef.current?.getBoundingClientRect()
    if (rect) onContextMenu(rect.left, rect.bottom + 2)
    else onContextMenu(e.clientX, e.clientY)
  }

  return (
    <li
      data-testid="archived-thread-row"
      data-thread-id={id}
      className="thread-row te-thread-arow"
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu(e.clientX, e.clientY)
      }}
    >
      <div className="te-thread-row__line">
        <span className="te-thread-arow__title">{title}</span>
        <button
          ref={kebabRef}
          type="button"
          className="thread-row__kebab te-thread-kebab"
          aria-label="Archived thread actions"
          title="More"
          onClick={handleKebab}
        >
          ⋯
        </button>
      </div>
      <AgentBadge agent={agent} />
    </li>
  )
}

function VaultSwitcher({
  name,
  fullPath,
  onClick
}: {
  readonly name: string
  readonly fullPath: string | null
  readonly onClick?: () => void
}) {
  const disabled = !onClick
  return (
    <button
      type="button"
      className="vault-switcher"
      onClick={onClick}
      disabled={disabled}
      title={fullPath ? `${fullPath}\nClick to switch vault` : 'Open a vault'}
      aria-label={fullPath ? `Vault: ${name}. Click to switch.` : 'Open a vault'}
    >
      <svg
        width={11}
        height={11}
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="te-vault-switcher__icon"
      >
        <path d="M2 3.5a1 1 0 0 1 1-1h2.4l1 1.2H9a1 1 0 0 1 1 1V9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5z" />
      </svg>
      <span className="te-vault-switcher__name">{name}</span>
      {!disabled && (
        <svg
          className="vault-switcher__chevron"
          width={9}
          height={9}
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M3.5 5l2.5 2.5L8.5 5" />
        </svg>
      )}
    </button>
  )
}

interface ThreadRowProps {
  readonly id: string
  readonly title: string
  readonly agent: AgentIdentity
  readonly isActive: boolean
  readonly isRenaming: boolean
  readonly onSelect: () => void
  readonly onContextMenu: (x: number, y: number) => void
  readonly onCommitRename: (value: string) => void
  readonly onCancelRename: () => void
}

function ThreadRow({
  id,
  title,
  agent,
  isActive,
  isRenaming,
  onSelect,
  onContextMenu,
  onCommitRename,
  onCancelRename
}: ThreadRowProps) {
  const kebabRef = useRef<HTMLButtonElement | null>(null)

  function handleKebab(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation()
    const rect = kebabRef.current?.getBoundingClientRect()
    if (rect) onContextMenu(rect.left, rect.bottom + 2)
    else onContextMenu(e.clientX, e.clientY)
  }

  return (
    <li
      data-testid="thread-row"
      data-thread-id={id}
      data-active={isActive ? 'true' : undefined}
      data-renaming={isRenaming ? 'true' : undefined}
      className="thread-row te-thread-row"
      onClick={isRenaming ? undefined : onSelect}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu(e.clientX, e.clientY)
      }}
    >
      <div className="te-thread-row__line">
        {isRenaming ? (
          <RenameInput initial={title} onCommit={onCommitRename} onCancel={onCancelRename} />
        ) : (
          <span className="te-thread-row__title">{title}</span>
        )}
        {!isRenaming && (
          <button
            ref={kebabRef}
            type="button"
            className="thread-row__kebab te-thread-kebab"
            aria-label="Thread actions"
            title="More"
            onClick={handleKebab}
          >
            ⋯
          </button>
        )}
      </div>
      <AgentBadge agent={agent} />
    </li>
  )
}

function NewAgentButton({
  onClick,
  disabled = false
}: {
  readonly onClick: () => void
  readonly disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label="Create a local agent"
      title={disabled ? 'Open a vault first (use Open Folder)' : 'Create a local agent'}
      className="te-new-thread-button"
    >
      <Bot size={12} strokeWidth={1.6} aria-hidden className="te-thread-btn-icon" />
      <span>New Agent</span>
    </button>
  )
}

function NewThreadButton({
  onClick,
  disabled = false
}: {
  readonly onClick: () => void
  readonly disabled?: boolean
}) {
  // Without a vault, createThread rejects silently ("vault not set"), so the
  // affordance is disabled with a pointer at the Open Folder flow instead.
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={disabled ? 'Open a vault first (use Open Folder)' : 'New thread'}
      className="te-new-thread-button"
    >
      <svg width={11} height={11} viewBox="0 0 11 11" aria-hidden className="te-thread-btn-icon">
        <path
          d="M5.5 1V10 M1 5.5H10"
          stroke="currentColor"
          strokeWidth={1.4}
          strokeLinecap="round"
        />
      </svg>
      <span>New Thread</span>
    </button>
  )
}

function RenameInput({
  initial,
  onCommit,
  onCancel
}: {
  readonly initial: string
  readonly onCommit: (value: string) => void
  readonly onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onCommit(value)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        }
      }}
      onBlur={() => onCommit(value)}
      className="te-thread-rename-input"
    />
  )
}
