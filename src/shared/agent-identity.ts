// 'cli-raw' appended in workstation Phase 2 step 1: the raw fallback adapter
// (unknown agent CLIs run as a plain PTY — PLAN Q8). Append-only: existing
// persisted threads index into this union by value, never by position.
export const AGENT_IDENTITIES = [
  'machina-native',
  'cli-claude',
  'cli-codex',
  'cli-gemini',
  'cli-raw'
] as const

export type AgentIdentity = (typeof AGENT_IDENTITIES)[number]

export function isAgentIdentity(value: unknown): value is AgentIdentity {
  return typeof value === 'string' && (AGENT_IDENTITIES as readonly string[]).includes(value)
}
