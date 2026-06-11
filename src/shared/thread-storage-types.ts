import type { AgentIdentity } from './agent-identity'

export interface VaultMachinaConfig {
  defaultAgent: AgentIdentity
  defaultModel: string
  welcomed: boolean
  customKeybindings: Record<string, string>
  /** Pixel width of the thread sidebar. Optional for back-compat. */
  sidebarWidth?: number
  /** Pixel width of the surface dock. Legacy — the dock now flexes; kept so old configs parse. */
  dockWidth?: number
  /** Pixel width of the chat panel. Optional for back-compat. */
  chatWidth?: number
  /** Whether the surface dock starts collapsed. Persisted across restart. */
  dockCollapsed?: boolean
  /** Whether the thread sidebar starts hidden. Persisted across restart. */
  sidebarCollapsed?: boolean
  /** Whether the chat panel starts hidden. Persisted across restart. */
  chatCollapsed?: boolean
}

export const DEFAULT_VAULT_MACHINA_CONFIG: VaultMachinaConfig = {
  defaultAgent: 'machina-native',
  defaultModel: 'claude-sonnet-4-6',
  welcomed: false,
  customKeybindings: {}
}
