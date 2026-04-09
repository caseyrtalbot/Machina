import { useEffect, useRef } from 'react'
import { colors } from '../../design/tokens'
import { AGENT_ACTIONS, type AgentActionName } from '@shared/agent-action-types'

interface CardContextMenuProps {
  readonly x: number
  readonly y: number
  readonly onShowConnections: () => void
  readonly onOpenInEditor?: () => void
  readonly onRunClaude?: () => void
  readonly onCopyPath: () => void
  readonly onClose: () => void
  readonly selectedCount: number
  readonly onAgentAction?: (action: AgentActionName) => void
  readonly onAskPrompt?: (placeholder?: string) => void
  readonly agentBusy?: boolean
}

interface MenuItemProps {
  readonly label: string
  readonly onClick: () => void
  readonly disabled?: boolean
}

function MenuItem({ label, onClick, disabled }: MenuItemProps) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        if (!disabled) onClick()
      }}
      className="w-full text-left px-3 py-1 text-xs transition-colors"
      style={{
        color: disabled ? colors.text.secondary : colors.text.primary,
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'default' : 'pointer'
      }}
      onMouseEnter={(e) => {
        if (!disabled) (e.currentTarget as HTMLElement).style.backgroundColor = colors.accent.muted
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
      }}
    >
      {label}
    </button>
  )
}

export function CardContextMenu({
  x,
  y,
  onShowConnections,
  onOpenInEditor,
  onRunClaude,
  onCopyPath,
  onClose,
  selectedCount,
  onAgentAction,
  onAskPrompt,
  agentBusy
}: CardContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div
      ref={ref}
      data-testid="card-context-menu"
      className="fixed border py-1 z-50"
      style={{
        left: x,
        top: y,
        backgroundColor: colors.bg.elevated,
        borderColor: colors.border.default,
        borderRadius: 8,
        minWidth: 180,
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)'
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <MenuItem
        label="Show Connections"
        onClick={() => {
          onShowConnections()
          onClose()
        }}
      />
      {onOpenInEditor && (
        <MenuItem
          label="Open in Editor"
          onClick={() => {
            onOpenInEditor()
            onClose()
          }}
        />
      )}
      {onRunClaude && (
        <MenuItem
          label="Run Claude on this note"
          onClick={() => {
            onRunClaude()
            onClose()
          }}
        />
      )}
      <div
        style={{
          height: 1,
          backgroundColor: colors.border.subtle,
          margin: '4px 8px'
        }}
      />
      <MenuItem
        label="Copy Path"
        onClick={() => {
          onCopyPath()
          onClose()
        }}
      />
      {onAgentAction && (
        <>
          <div
            style={{
              height: 1,
              backgroundColor: colors.border.subtle,
              margin: '4px 8px'
            }}
          />
          <div
            className="px-3 py-1 text-[10px]"
            style={{ color: colors.text.secondary, opacity: 0.5 }}
          >
            Agent
          </div>
          {AGENT_ACTIONS.filter(
            (a) => a.requiresSelection === 0 || selectedCount >= a.requiresSelection
          ).map((action) => (
            <MenuItem
              key={action.id}
              label={action.label}
              onClick={() => {
                if (action.id === 'ask' && onAskPrompt) {
                  const hint =
                    selectedCount === 1
                      ? 'Ask about this card...'
                      : `Ask about ${selectedCount} selected cards...`
                  onAskPrompt(hint)
                } else {
                  onAgentAction?.(action.id as AgentActionName)
                }
                onClose()
              }}
              disabled={agentBusy}
            />
          ))}
        </>
      )}
    </div>
  )
}
