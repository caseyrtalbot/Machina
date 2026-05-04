import type { AgentIdentity } from '@shared/agent-identity'

export function agentPillStyle(_agent: AgentIdentity): {
  background: string
  border: string
  color: string
} {
  return {
    background: 'transparent',
    border: '1px solid transparent',
    color: 'var(--color-text-primary)'
  }
}
