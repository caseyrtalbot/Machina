import type { AgentIdentity } from './agent-identity'

export interface VaultMachinaConfig {
  defaultAgent: AgentIdentity
  defaultModel: string
  welcomed: boolean
  customKeybindings: Record<string, string>
  /** Pixel width of the thread sidebar. Optional for back-compat. */
  sidebarWidth?: number
  /** Pixel width of the surface dock. Optional for back-compat. */
  dockWidth?: number
}

export const DEFAULT_VAULT_MACHINA_CONFIG: VaultMachinaConfig = {
  defaultAgent: 'machina-native',
  defaultModel: 'claude-sonnet-4-6',
  welcomed: false,
  customKeybindings: {}
}
