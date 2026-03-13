import { useState, useRef, useEffect } from 'react'
import { useTerminalStore } from '../../store/terminal-store'
import { colors } from '../../design/tokens'

const STATUS_DOT_SHELL = colors.semantic.cluster
const STATUS_DOT_AGENT = '#A78BFA'

function sessionDotColor(title: string): string {
  return title.toLowerCase().includes('claude') ? STATUS_DOT_AGENT : STATUS_DOT_SHELL
}

interface TerminalTabsProps {
  onNewTab: () => void
  onCloseTab: (sessionId: string) => void
}

export function TerminalTabs({ onNewTab, onCloseTab }: TerminalTabsProps) {
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
      className="flex items-center h-8 border-b overflow-x-auto"
      style={{ backgroundColor: colors.bg.surface, borderColor: colors.border.default }}
    >
      {sessions.map((session) => {
        const isActive = session.id === activeSessionId
        const dotColor = sessionDotColor(session.title)

        return (
          <div
            key={session.id}
            onClick={() => setActiveSession(session.id)}
            className="flex items-center gap-1 px-3 py-1 text-xs cursor-pointer border-r transition-colors"
            style={{
              borderColor: colors.border.default,
              backgroundColor: isActive ? colors.bg.elevated : 'transparent',
              color: isActive ? colors.text.primary : colors.text.secondary
            }}
          >
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

            {/* Close button: hidden when only one tab */}
            {sessions.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onCloseTab(session.id)
                }}
                className="ml-1 hover:text-white"
                style={{ color: colors.text.muted }}
              >
                x
              </button>
            )}
          </div>
        )
      })}
      <button
        onClick={onNewTab}
        className="px-2 py-1 text-xs transition-colors"
        style={{ color: colors.text.muted }}
      >
        +
      </button>
    </div>
  )
}
