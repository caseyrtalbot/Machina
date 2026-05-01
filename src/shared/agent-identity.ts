export const AGENT_IDENTITIES = ['machina-native', 'cli-claude', 'cli-codex', 'cli-gemini'] as const

export type AgentIdentity = (typeof AGENT_IDENTITIES)[number]

export function isAgentIdentity(value: unknown): value is AgentIdentity {
  return typeof value === 'string' && (AGENT_IDENTITIES as readonly string[]).includes(value)
}
