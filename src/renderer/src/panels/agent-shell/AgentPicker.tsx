import type { AgentIdentity } from '@shared/agent-identity'
import { agentTag } from './agent-tag'
import { colors, borderRadius } from '../../design/tokens'

const AGENTS: readonly AgentIdentity[] = ['machina-native', 'cli-claude', 'cli-codex', 'cli-gemini']

export function AgentPicker({
  onPick,
  onCancel
}: {
  readonly onPick: (a: AgentIdentity) => void
  readonly onCancel: () => void
}) {
  return (
    <div
      role="menu"
      style={{
        position: 'absolute',
        bottom: 50,
        left: 12,
        background: colors.bg.elevated,
        border: `1px solid ${colors.border.default}`,
        padding: 6,
        borderRadius: borderRadius.container
      }}
    >
      {AGENTS.map((a) => (
        <div
          key={a}
          role="menuitem"
          onClick={() => onPick(a)}
          style={{ padding: '4px 8px', cursor: 'pointer' }}
        >
          /{agentTag(a)}
        </div>
      ))}
      <div
        role="menuitem"
        onClick={onCancel}
        style={{
          padding: '4px 8px',
          cursor: 'pointer',
          fontSize: 11,
          color: colors.text.muted
        }}
      >
        Cancel
      </div>
    </div>
  )
}
