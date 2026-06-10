import { useMemo, useRef, useState } from 'react'
import { useThreadStore } from '../../store/thread-store'
import { useVaultStore } from '../../store/vault-store'
import { colors, borderRadius, transitions, typography } from '../../design/tokens'
import { ContextMenu, type ContextMenuPosition } from '../../components/ContextMenu'
import { AgentPicker } from './AgentPicker'
import { AgentBadge } from './agent-badge'
import type { AgentIdentity } from '@shared/agent-identity'
import type { Thread } from '@shared/thread-types'
import { DEFAULT_NATIVE_MODEL } from '@shared/machina-native-tools'

interface ThreadSidebarProps {
  readonly width?: number
  readonly onChangeVault?: () => void
}

interface MenuTarget {
  readonly threadId: string
  readonly position: ContextMenuPosition
  /** True when the menu targets a row in the Archived section. */
  readonly archived: boolean
}

export function ThreadSidebar({ width = 240, onChangeVault }: ThreadSidebarProps = {}) {
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
    <aside
      style={{
        width,
        flexShrink: 0,
        background: colors.bg.rail,
        display: 'flex',
        flexDirection: 'column',
        height: '100%'
      }}
    >
      <header
        style={{
          height: 44,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'stretch',
          borderBottom: `1px solid ${colors.border.subtle}`,
          boxSizing: 'border-box'
        }}
      >
        <VaultSwitcher
          name={vaultPath ? vaultName : 'Open vault…'}
          fullPath={vaultPath ?? null}
          onClick={onChangeVault}
        />
      </header>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
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
      <footer
        style={{
          padding: '12px 8px 16px',
          borderTop: `1px solid ${colors.border.subtle}`
        }}
      >
        {pickerOpen && vaultPath ? (
          <AgentPicker
            onPick={(a) => {
              setPickerOpen(false)
              void createThread(a, DEFAULT_NATIVE_MODEL)
            }}
            onCancel={() => setPickerOpen(false)}
          />
        ) : (
          <NewThreadButton disabled={!vaultPath} onClick={() => setPickerOpen(true)} />
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
    <section style={{ borderTop: `1px solid ${colors.border.subtle}` }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        data-testid="archived-section-toggle"
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 12px',
          background: 'transparent',
          border: 'none',
          color: colors.text.muted,
          cursor: 'pointer',
          fontFamily: typography.fontFamily.mono,
          fontSize: 11,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          textAlign: 'left'
        }}
      >
        <span
          aria-hidden
          style={{
            display: 'inline-block',
            transform: open ? 'rotate(90deg)' : 'none',
            transition: `transform ${transitions.micro}`,
            fontSize: 9
          }}
        >
          ▶
        </span>
        Archived{open ? ` (${threads.length})` : ''}
      </button>
      {open && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {threads.length === 0 ? (
            <li
              style={{
                padding: '4px 12px 10px',
                color: colors.text.muted,
                fontFamily: typography.fontFamily.mono,
                fontSize: 11
              }}
            >
              No archived threads
            </li>
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
  const [hovered, setHovered] = useState(false)
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
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu(e.clientX, e.clientY)
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '6px 12px',
        background: hovered
          ? 'color-mix(in srgb, var(--color-text-primary) 4%, transparent)'
          : 'transparent',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        transition: `background ${transitions.focusRing}`
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span
          style={{
            flex: 1,
            color: colors.text.muted,
            fontFamily: typography.fontFamily.mono,
            fontSize: 12,
            letterSpacing: '0.01em',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {title}
        </span>
        <button
          ref={kebabRef}
          type="button"
          aria-label="Archived thread actions"
          title="More"
          onClick={handleKebab}
          style={{
            flexShrink: 0,
            width: 18,
            height: 18,
            padding: 0,
            border: 'none',
            background: 'transparent',
            color: colors.text.muted,
            cursor: 'pointer',
            opacity: hovered ? 1 : 0,
            transition: `opacity ${transitions.micro}`,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            lineHeight: 1
          }}
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
  const [hovered, setHovered] = useState(false)
  const disabled = !onClick
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      disabled={disabled}
      title={fullPath ? `${fullPath}\nClick to switch vault` : 'Open a vault'}
      aria-label={fullPath ? `Vault: ${name}. Click to switch.` : 'Open a vault'}
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 14px',
        background:
          hovered && !disabled
            ? 'color-mix(in srgb, var(--color-text-primary) 4%, transparent)'
            : 'transparent',
        border: 'none',
        borderRadius: 0,
        color: disabled ? colors.text.muted : colors.text.primary,
        cursor: disabled ? 'default' : 'pointer',
        textAlign: 'left',
        minWidth: 0,
        transition: `background ${transitions.focusRing}`
      }}
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
        style={{ flexShrink: 0, opacity: 0.7 }}
      >
        <path d="M2 3.5a1 1 0 0 1 1-1h2.4l1 1.2H9a1 1 0 0 1 1 1V9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5z" />
      </svg>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontFamily: typography.fontFamily.mono,
          fontSize: 12,
          letterSpacing: '0.01em',
          color: 'inherit'
        }}
      >
        {name}
      </span>
      {!disabled && (
        <svg
          width={9}
          height={9}
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          style={{
            flexShrink: 0,
            color: colors.text.muted,
            opacity: hovered ? 1 : 0.7,
            transition: `opacity ${transitions.focusRing}`
          }}
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
  const [hovered, setHovered] = useState(false)
  const kebabRef = useRef<HTMLButtonElement | null>(null)

  function handleKebab(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation()
    const rect = kebabRef.current?.getBoundingClientRect()
    if (rect) onContextMenu(rect.left, rect.bottom + 2)
    else onContextMenu(e.clientX, e.clientY)
  }

  const rowBg =
    hovered && !isActive
      ? 'color-mix(in srgb, var(--color-text-primary) 4%, transparent)'
      : 'transparent'

  return (
    <li
      data-testid="thread-row"
      data-thread-id={id}
      onClick={isRenaming ? undefined : onSelect}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu(e.clientX, e.clientY)
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '8px 12px',
        cursor: isRenaming ? 'text' : 'pointer',
        background: rowBg,
        boxShadow: isActive
          ? `inset 0 0 0 1px color-mix(in srgb, ${colors.text.primary} 55%, transparent)`
          : 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        position: 'relative',
        transition: `background ${transitions.focusRing}`
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {isRenaming ? (
          <RenameInput initial={title} onCommit={onCommitRename} onCancel={onCancelRename} />
        ) : (
          <span
            style={{
              flex: 1,
              color: isActive ? colors.text.primary : colors.text.secondary,
              fontFamily: typography.fontFamily.mono,
              fontSize: 12,
              fontWeight: isActive ? 500 : 400,
              letterSpacing: '0.01em',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {title}
          </span>
        )}
        {!isRenaming && (
          <button
            ref={kebabRef}
            type="button"
            aria-label="Thread actions"
            title="More"
            onClick={handleKebab}
            style={{
              flexShrink: 0,
              width: 18,
              height: 18,
              padding: 0,
              border: 'none',
              background: 'transparent',
              color: colors.text.muted,
              cursor: 'pointer',
              opacity: hovered || isActive ? 1 : 0,
              transition: `opacity ${transitions.micro}`,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              lineHeight: 1
            }}
          >
            ⋯
          </button>
        )}
      </div>
      <AgentBadge agent={agent} />
    </li>
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
      style={disabled ? { opacity: 0.45, cursor: 'default' } : undefined}
    >
      <svg width={11} height={11} viewBox="0 0 11 11" aria-hidden style={{ flexShrink: 0 }}>
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
      style={{
        flex: 1,
        background: colors.bg.base,
        border: `1px solid ${colors.border.default}`,
        borderRadius: borderRadius.inline,
        color: colors.text.primary,
        fontFamily: typography.fontFamily.mono,
        fontSize: 12,
        padding: '2px 6px',
        outline: 'none',
        minWidth: 0
      }}
    />
  )
}
