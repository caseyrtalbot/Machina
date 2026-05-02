import { typedHandle } from '../typed-ipc'
import { resolveAnthropicKey, setAnthropicKey, clearAnthropicKey } from '../services/anthropic-key'
import { runMachinaNative, abortMachinaNative } from '../services/machina-native-agent'
import { decideApproval } from '../services/machina-native-tools'

export function registerAgentNativeIpc(): void {
  typedHandle('agent-native:has-key', async () => (await resolveAnthropicKey()) !== null)
  typedHandle('agent-native:set-key', async ({ key }) => setAnthropicKey(key))
  typedHandle('agent-native:clear-key', async () => clearAnthropicKey())
  typedHandle('agent-native:run', async (req) => ({ runId: await runMachinaNative(req) }))
  typedHandle('agent-native:abort', async ({ runId }) => abortMachinaNative(runId))
  typedHandle('agent-native:tool-decision', async ({ toolUseId, accept, rejectReason }) => {
    decideApproval(toolUseId, accept, rejectReason)
  })
}
