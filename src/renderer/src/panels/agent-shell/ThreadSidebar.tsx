import { useMemo, useRef, useState } from 'react'
import { useThreadStore } from '../../store/thread-store'
import { useVaultStore } from '../../store/vault-store'
import { agentTag } from './agent-tag'
import { agentPillStyle } from './agent-color'
import { colors, borderRadius, typography } from '../../design/tokens'
import { ContextMenu, type ContextMenuPosition } from '../../components/ContextMenu'
import type { AgentIdentity } from '@shared/agent-identity'

export interface ThreadSidebarProps {
  readonly onOpenSettings?: () => void
  readonly width?: number
}

interface MenuTarget {
  readonly threadId: string
  readonly position: ContextMenuPosition
}

export function ThreadSidebar({ onOpenSettings, width = 240 }: ThreadSidebarProps = {}) {
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
          padding: '14px 14px 12px',
          fontFamily: typography.fontFamily.mono,
          fontSize: typography.metadata.size,
          letterSpacing: typography.metadata.letterSpacing,
          textTransform: typography.metadata.textTransform,
          color: colors.text.muted,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          borderBottom: `1px solid ${colors.border.subtle}`
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
      <footer style={{ padding: 8, borderTop: `1px solid ${colors.border.subtle}` }}>
        {pickerOpen ? (
          <NewThreadPicker
            onPick={(a) => {
              setPickerOpen(false)
              void createThread(a, 'claude-sonnet-4-6')
            }}
            onCancel={() => setPickerOpen(false)}
          />
        ) : (
          <NewThreadButton onClick={() => setPickerOpen(true)} />
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

  const pill = agentPillStyle(agent)
  const rowBg = isActive
    ? colors.bg.elevated
    : hovered
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
        padding: '8px 12px 8px 10px',
        cursor: isRenaming ? 'text' : 'pointer',
        background: rowBg,
        borderLeft: `2px solid ${isActive ? colors.accent.default : 'transparent'}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        position: 'relative',
        transition: 'background 100ms ease-out'
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
          fontFamily: typography.fontFamily.mono,
          fontSize: 9,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          padding: '1px 6px',
          borderRadius: borderRadius.inline,
          background: pill.background,
          border: pill.border,
          color: pill.color,
          alignSelf: 'flex-start'
        }}
      >
        {agentTag(agent)}
      </span>
    </li>
  )
}

function NewThreadButton({ onClick }: { readonly onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      title="New thread"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100%',
        padding: '8px 10px',
        background: hovered
          ? 'color-mix(in srgb, var(--color-accent-default) 8%, transparent)'
          : 'transparent',
        border: `1px solid ${hovered ? colors.accent.line : 'transparent'}`,
        color: hovered ? colors.accent.default : colors.text.muted,
        borderRadius: borderRadius.inline,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontFamily: typography.fontFamily.mono,
        fontSize: typography.metadata.size,
        letterSpacing: typography.metadata.letterSpacing,
        textTransform: typography.metadata.textTransform,
        textAlign: 'left',
        transition: 'background 120ms ease-out, color 120ms ease-out, border-color 120ms ease-out'
      }}
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
    <div role="menu" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {AGENTS.map((a) => (
        <button
          key={a}
          onClick={() => onPick(a)}
          style={{
            textAlign: 'left',
            padding: '6px 8px',
            background: 'transparent',
            border: `1px solid ${colors.border.subtle}`,
            borderRadius: borderRadius.inline,
            color: colors.text.secondary,
            fontFamily: typography.fontFamily.mono,
            fontSize: typography.metadata.size,
            letterSpacing: typography.metadata.letterSpacing,
            textTransform: typography.metadata.textTransform,
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
          padding: '6px 8px',
          fontFamily: typography.fontFamily.mono,
          fontSize: typography.metadata.size,
          letterSpacing: typography.metadata.letterSpacing,
          textTransform: typography.metadata.textTransform,
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
