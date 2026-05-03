import { useEffect, useRef, useState } from 'react'
import type { AgentIdentity } from '@shared/agent-identity'
import { borderRadius, colors, typography } from '../../design/tokens'
import { AgentBadge } from './agent-badge'

const AGENTS: readonly AgentIdentity[] = ['machina-native', 'cli-claude', 'cli-codex', 'cli-gemini']

export function AgentPicker({
  onPick,
  onCancel
}: {
  readonly onPick: (a: AgentIdentity) => void
  readonly onCancel: () => void
}) {
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((a) => (a + 1) % AGENTS.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((a) => (a - 1 + AGENTS.length) % AGENTS.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onPick(AGENTS[active])
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onCancel()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('mousedown', onMouseDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [active, onPick, onCancel])

  return (
    <div
      ref={ref}
      role="menu"
      style={{
        background: colors.bg.elevated,
        border: `1px solid ${colors.border.default}`,
        padding: 4,
        borderRadius: borderRadius.tool
      }}
    >
      {AGENTS.map((a, i) => {
        const isActive = i === active
        return (
          <div
            key={a}
            role="menuitem"
            aria-selected={isActive}
            onMouseEnter={() => setActive(i)}
            onClick={() => onPick(a)}
            style={{
              padding: '6px 10px',
              cursor: 'pointer',
              borderRadius: borderRadius.inline,
              background: isActive
                ? 'color-mix(in srgb, var(--color-accent-default) 12%, transparent)'
                : 'transparent',
              color: isActive ? colors.accent.default : colors.text.secondary,
              fontFamily: typography.fontFamily.mono,
              fontSize: typography.metadata.size,
              letterSpacing: typography.metadata.letterSpacing,
              textTransform: typography.metadata.textTransform,
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <AgentBadge agent={a} compact />
          </div>
        )
      })}
      <div
        role="menuitem"
        onClick={onCancel}
        style={{
          padding: '6px 10px',
          cursor: 'pointer',
          fontFamily: typography.fontFamily.mono,
          fontSize: typography.metadata.size,
          letterSpacing: typography.metadata.letterSpacing,
          textTransform: typography.metadata.textTransform,
          color: colors.text.muted
        }}
      >
        Cancel
      </div>
    </div>
  )
}
