import type { AgentIdentity } from './agent-identity'

export interface VaultMachinaConfig {
  defaultAgent: AgentIdentity
  defaultModel: string
  welcomed: boolean
  customKeybindings: Record<string, string>
}

export const DEFAULT_VAULT_MACHINA_CONFIG: VaultMachinaConfig = {
  defaultAgent: 'machina-native',
  defaultModel: 'claude-sonnet-4-6',
  welcomed: false,
  customKeybindings: {}
}
