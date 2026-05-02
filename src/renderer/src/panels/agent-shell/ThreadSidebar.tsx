import { useMemo, useState } from 'react'
import { useThreadStore } from '../../store/thread-store'
import { useVaultStore } from '../../store/vault-store'
import { agentTag } from './agent-tag'
import { colors, borderRadius } from '../../design/tokens'
import type { AgentIdentity } from '@shared/agent-identity'

export interface ThreadSidebarProps {
  readonly onOpenSettings?: () => void
}

export function ThreadSidebar({ onOpenSettings }: ThreadSidebarProps = {}) {
  const threadsById = useThreadStore((s) => s.threadsById)
  const activeId = useThreadStore((s) => s.activeThreadId)
  const selectThread = useThreadStore((s) => s.selectThread)
  const createThread = useThreadStore((s) => s.createThread)
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const vaultName = vaultPath?.split('/').pop() || 'Vault'

  const sorted = useMemo(
    () => Object.values(threadsById).sort((a, b) => b.lastMessage.localeCompare(a.lastMessage)),
    [threadsById]
  )

  const [pickerOpen, setPickerOpen] = useState(false)

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
          <li
            key={t.id}
            data-testid="thread-row"
            onClick={() => void selectThread(t.id)}
            style={{
              padding: 8,
              cursor: 'pointer',
              background: activeId === t.id ? colors.bg.elevated : 'transparent',
              borderLeft: `2px solid ${activeId === t.id ? colors.accent.default : 'transparent'}`,
              display: 'flex',
              flexDirection: 'column',
              gap: 4
            }}
          >
            <span
              style={{
                color: colors.text.primary,
                fontSize: 13,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {t.title}
            </span>
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
              {agentTag(t.agent)}
            </span>
          </li>
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
    </aside>
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
