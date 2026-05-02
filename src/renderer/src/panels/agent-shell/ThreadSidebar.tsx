import { useMemo, useRef, useState } from 'react'
import { useThreadStore } from '../../store/thread-store'
import { useVaultStore } from '../../store/vault-store'
import { agentTag } from './agent-tag'
import { colors, borderRadius } from '../../design/tokens'
import { ContextMenu, type ContextMenuPosition } from '../../components/ContextMenu'
import type { AgentIdentity } from '@shared/agent-identity'

export interface ThreadSidebarProps {
  readonly onOpenSettings?: () => void
}

interface MenuTarget {
  readonly threadId: string
  readonly position: ContextMenuPosition
}

export function ThreadSidebar({ onOpenSettings }: ThreadSidebarProps = {}) {
  const threadsById = useThreadStore((s) => s.threadsById)
  const activeId = useThreadStore((s) => s.activeThreadId)
  const selectThread = useThreadStore((s) => s.selectThread)
  const createThread = useThreadStore((s) => s.createThread)
  const archiveThread = useThreadStore((s) => s.archiveThread)
  const deleteThread = useThreadStore((s) => s.deleteThread)
  const renameThread = useThreadStore((s) => s.renameThread)
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const vaultName = vaultPath?.split('/').pop() || 'Vault'

  const sorted = useMemo(
    () => Object.values(threadsById).sort((a, b) => b.lastMessage.localeCompare(a.lastMessage)),
    [threadsById]
  )

  const [pickerOpen, setPickerOpen] = useState(false)
  const [menu, setMenu] = useState<MenuTarget | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)

  function openMenuAt(threadId: string, x: number, y: number) {
    setMenu({ threadId, position: { x, y } })
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
        width: 240,
        borderRight: `1px solid ${colors.border.default}`,
        display: 'flex',
        flexDirection: 'column',
        height: '100%'
      }}
    >
      <header
        style={{
          padding: 12,
          fontSize: 12,
          color: colors.text.muted,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8
        }}
      >
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0
          }}
        >
          {vaultName}
        </span>
        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Open settings"
            title="Settings"
            style={{
              background: 'transparent',
              border: 'none',
              padding: 2,
              cursor: 'pointer',
              color: colors.text.muted,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            <svg
              width={14}
              height={14}
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="8" cy="8" r="2.2" />
              <path d="M8 1.5v1.6M8 12.9v1.6M2.6 8H1M15 8h-1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1" />
            </svg>
          </button>
        )}
      </header>
      <ul style={{ flex: 1, overflowY: 'auto', listStyle: 'none', margin: 0, padding: 0 }}>
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
      <footer style={{ padding: 8, borderTop: `1px solid ${colors.border.default}` }}>
        {pickerOpen ? (
          <NewThreadPicker
            onPick={(a) => {
              setPickerOpen(false)
              void createThread(a, 'claude-sonnet-4-6')
            }}
            onCancel={() => setPickerOpen(false)}
          />
        ) : (
          <button
            onClick={() => setPickerOpen(true)}
            style={{
              width: '100%',
              padding: 4,
              background: 'transparent',
              border: `1px dashed ${colors.border.default}`,
              color: colors.text.primary,
              borderRadius: borderRadius.inline,
              cursor: 'pointer'
            }}
          >
            + New thread
          </button>
        )}
      </footer>
      {menu && (
        <ContextMenu
          position={menu.position}
          onClose={() => setMenu(null)}
          items={[
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
          ]}
        />
      )}
    </aside>
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
        padding: 8,
        cursor: isRenaming ? 'text' : 'pointer',
        background: isActive ? colors.bg.elevated : 'transparent',
        borderLeft: `2px solid ${isActive ? colors.accent.default : 'transparent'}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        position: 'relative'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {isRenaming ? (
          <RenameInput initial={title} onCommit={onCommitRename} onCancel={onCancelRename} />
        ) : (
          <span
            style={{
              flex: 1,
              color: colors.text.primary,
              fontSize: 13,
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
              transition: 'opacity 80ms ease',
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
      <span
        style={{
          display: 'inline-block',
          fontSize: 10,
          padding: '1px 6px',
          borderRadius: borderRadius.inline,
          background: colors.bg.elevated,
          color: colors.text.muted,
          alignSelf: 'flex-start'
        }}
      >
        {agentTag(agent)}
      </span>
    </li>
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
        fontSize: 13,
        padding: '2px 6px',
        outline: 'none',
        minWidth: 0
      }}
    />
  )
}

function NewThreadPicker({
  onPick,
  onCancel
}: {
  readonly onPick: (a: AgentIdentity) => void
  readonly onCancel: () => void
}) {
  const AGENTS: readonly AgentIdentity[] = [
    'machina-native',
    'cli-claude',
    'cli-codex',
    'cli-gemini'
  ]
  return (
    <div role="menu" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {AGENTS.map((a) => (
        <button
          key={a}
          onClick={() => onPick(a)}
          style={{
            textAlign: 'left',
            padding: 6,
            background: 'transparent',
            border: 'none',
            color: 'inherit',
            cursor: 'pointer'
          }}
        >
          {agentTag(a)}
        </button>
      ))}
      <button
        onClick={onCancel}
        style={{
          textAlign: 'left',
          padding: 6,
          fontSize: 11,
          color: colors.text.muted,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer'
        }}
      >
        Cancel
      </button>
    </div>
  )
}
