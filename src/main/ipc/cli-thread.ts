import { typedHandle } from '../typed-ipc'
import { CliThreadSpawner } from '../services/cli-thread-spawner'
import { getCliAgentThreadBridge, getShellService } from './shell'

let spawner: CliThreadSpawner | null = null

function getSpawner(): CliThreadSpawner {
  if (!spawner) {
    spawner = new CliThreadSpawner({
      shellService: getShellService(),
      bridge: getCliAgentThreadBridge()
    })
  }
  return spawner
}

export function registerCliThreadIpc(): void {
  typedHandle('cli-thread:spawn', async ({ threadId, identity, cwd }) => {
    return getSpawner().spawn(threadId, identity, cwd)
  })

  typedHandle('cli-thread:input', async ({ threadId, identity, text }) => {
    const ok = getSpawner().sendUserMessage(threadId, identity, text)
    return { ok }
  })

  typedHandle('cli-thread:close', async ({ threadId }) => {
    getSpawner().close(threadId)
  })
}
