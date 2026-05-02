import type { AgentIdentity } from '@shared/agent-identity'
import { ARTIFACT_COLORS } from '../../design/tokens'

// Per-agent OKLCH hues so the agent-tag pill differentiates at a glance.
// Reuses the artifact palette so pills sit consistent with other semantic
// surfaces in the app (session emerald, pattern amber, constraint red,
// research purple).
const AGENT_HUE: Record<AgentIdentity, string> = {
  'machina-native': ARTIFACT_COLORS.session,
  'cli-claude': ARTIFACT_COLORS.pattern,
  'cli-codex': ARTIFACT_COLORS.constraint,
  'cli-gemini': ARTIFACT_COLORS.research
}

export function getAgentColor(agent: AgentIdentity): string {
  return AGENT_HUE[agent]
}

export function agentPillStyle(agent: AgentIdentity): {
  background: string
  border: string
  color: string
} {
  const hue = getAgentColor(agent)
  return {
    background: `color-mix(in srgb, ${hue} 12%, transparent)`,
    border: `1px solid color-mix(in srgb, ${hue} 35%, transparent)`,
    color: hue
  }
}
