import { typedHandle } from '../typed-ipc'
import { runAgentAction } from '../services/agent-action-runner'

export function registerAgentActionIpc(): void {
  typedHandle('agent-action:compute', async (request) => {
    return runAgentAction(request)
  })
}
