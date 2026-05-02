import { typedHandle } from '../typed-ipc'
import { resolveAnthropicKey, setAnthropicKey, clearAnthropicKey } from '../services/anthropic-key'

export function registerAgentNativeIpc(): void {
  typedHandle('agent-native:has-key', async () => (await resolveAnthropicKey()) !== null)
  typedHandle('agent-native:set-key', async ({ key }) => setAnthropicKey(key))
  typedHandle('agent-native:clear-key', async () => clearAnthropicKey())
}
