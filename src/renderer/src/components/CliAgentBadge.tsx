import { borderRadius, colors, typography } from '../design/tokens'
import type { CLIAgentPresence } from '../hooks/use-cli-agent-presence'

/**
 * Small pill showing which CLI agent (claude/codex/gemini) is active in a
 * terminal session: status dot + agent name. Used on terminal cards and the
 * dock presence strip (item 3.12).
 *
 * In-progress reuses the `te-live-dot` accent pulse; finished runs show a
 * static semantic dot (green success / amber blocked).
 */

export function CliAgentBadge({ presence }: { readonly presence: CLIAgentPresence }) {
  const live = presence.status === 'in-progress'
  return (
    <span
      data-testid="cli-agent-badge"
      title={`${presence.agentId} · ${presence.status}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '1px 6px',
        flexShrink: 0,
        borderRadius: borderRadius.pill,
        border: `1px solid ${colors.border.default}`,
        color: colors.text.secondary,
        fontFamily: typography.fontFamily.mono,
        fontSize: typography.microLabel.size,
        letterSpacing: typography.microLabel.letterSpacing,
        textTransform: typography.microLabel.textTransform
      }}
    >
      {live ? (
        <span className="te-live-dot" style={{ width: 5, height: 5 }} />
      ) : (
        <span
          style={{
            width: 5,
            height: 5,
            flexShrink: 0,
            borderRadius: borderRadius.round,
            backgroundColor:
              presence.status === 'success' ? colors.claude.ready : colors.claude.warning
          }}
        />
      )}
      {presence.agentId}
    </span>
  )
}
