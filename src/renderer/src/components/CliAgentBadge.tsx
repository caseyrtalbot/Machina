import { colors } from '../design/tokens'
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
      className="te-cli-badge"
      data-testid="cli-agent-badge"
      title={`${presence.agentId} · ${presence.status}`}
    >
      {live ? (
        <span className="te-live-dot te-cli-badge__dot" />
      ) : (
        <span
          className="te-cli-badge__dot"
          style={{
            backgroundColor:
              presence.status === 'success' ? colors.claude.ready : colors.claude.warning
          }}
        />
      )}
      {presence.agentId}
    </span>
  )
}
