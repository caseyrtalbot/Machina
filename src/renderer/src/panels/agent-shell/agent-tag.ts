import type { AgentIdentity } from '@shared/agent-identity'

export function agentTag(a: AgentIdentity): string {
  switch (a) {
    case 'machina-native':
      return 'native'
    case 'cli-claude':
      return 'claude'
    case 'cli-codex':
      return 'codex'
    case 'cli-gemini':
      return 'gemini'
  }
}
