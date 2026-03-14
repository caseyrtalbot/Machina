import { useState, useRef, useEffect } from 'react'
import { useTerminalStore } from '../../store/terminal-store'
import { colors } from '../../design/tokens'
import { ClaudeActivateButton } from './ClaudeActivateButton'

const STATUS_DOT_SHELL = colors.semantic.cluster
const STATUS_DOT_AGENT = '#00e5bf'

function sessionDotColor(title: string): string {
  return title.toLowerCase().includes('claude') ? STATUS_DOT_AGENT : STATUS_DOT_SHELL
}

interface TerminalTabsProps {
  onNewTab: () => void
  onCloseTab: (sessionId: string) => void
  onActivateClaude: () => void
  claudeSessionActive: boolean
  vaultPath: string | null
}

export function TerminalTabs({
  onNewTab,
  onCloseTab,
  onActivateClaude,
  claudeSessionActive,
  vaultPath
}: TerminalTabsProps) {
  const { sessions, activeSessionId, setActiveSession, renameSession } = useTerminalStore()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingId])

  function startEditing(id: string, currentTitle: string) {
    setEditingId(id)
    setEditValue(currentTitle)
  }

  function confirmRename() {
    if (editingId) {
      const trimmed = editValue.trim()
      if (trimmed) {
        renameSession(editingId, trimmed)
      }
    }
    setEditingId(null)
    setEditValue('')
  }

  function cancelRename() {
    setEditingId(null)
    setEditValue('')
  }

  return (
    <div
      data-testid="terminal-tabs"
      className="flex items-center overflow-x-auto gap-1 shrink-0"
      style={{
        height: 32,
        padding: '0 8px',
        borderBottom: '1px solid var(--border-subtle)'
      }}
    >
      {sessions.map((session) => {
        const isActive = session.id === activeSessionId
        const dotColor = sessionDotColor(session.title)

        return (
          <div
            key={session.id}
            onClick={() => setActiveSession(session.id)}
            className="relative flex items-center gap-1.5 cursor-pointer group shrink-0 whitespace-nowrap"
            style={{
              padding: '4px 10px',
              fontSize: 12,
              fontWeight: isActive ? 500 : 400,
              color: isActive ? colors.text.primary : colors.text.secondary,
              transition: '150ms ease-out'
            }}
          >
            {/* Active bottom indicator */}
            {isActive && (
              <span
                className="absolute bottom-0 left-2 right-2"
                style={{
                  height: 2,
                  borderRadius: 1,
                  backgroundColor: colors.accent.default
                }}
              />
            )}

            {/* Status dot */}
            <span
              className="shrink-0 rounded-full"
              style={{ width: 6, height: 6, backgroundColor: dotColor }}
            />

            {/* Title or rename input */}
            {editingId === session.id ? (
              <input
                ref={inputRef}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmRename()
                  if (e.key === 'Escape') cancelRename()
                }}
                onBlur={confirmRename}
                onClick={(e) => e.stopPropagation()}
                className="bg-transparent outline-none border-b text-xs"
                style={{
                  color: colors.text.primary,
                  borderColor: colors.accent.default,
                  width: Math.max(editValue.length, 4) + 'ch'
                }}
              />
            ) : (
              <span
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  startEditing(session.id, session.title)
                }}
              >
                {session.title}
              </span>
            )}

            {/* Close button: visible on hover only */}
            {sessions.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onCloseTab(session.id)
                }}
                className="opacity-0 group-hover:opacity-60"
                style={{
                  color: colors.text.primary,
                  fontSize: 11,
                  transition: '150ms ease-out'
                }}
              >
                x
              </button>
            )}
          </div>
        )
      })}
      <button
        onClick={onNewTab}
        className="px-2 py-1 text-xs transition-opacity"
        style={{ color: colors.text.muted, opacity: 0.6 }}
        onMouseEnter={(e) => {
          e.currentTarget.style.opacity = '1'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.opacity = '0.6'
        }}
      >
        +
      </button>
      <div className="flex-1" />
      <div className="px-2">
        <ClaudeActivateButton
          onClick={onActivateClaude}
          isActive={claudeSessionActive}
          disabled={!vaultPath}
        />
      </div>
    </div>
  )
}
