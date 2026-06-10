import { typedHandle } from '../typed-ipc'
import { CliThreadSpawner } from '../services/cli-thread-spawner'
import { getCliAgentThreadBridge, getShellService } from './shell'
import { readAppConfigValue } from './config'

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
    // Spawn-on-demand: the spawner's threadId → sessionId map is in-memory,
    // so persisted threads have no session after a relaunch. cwd mirrors
    // createThread's spawn args — the active vault path, which the renderer
    // persists as lastVaultPath on every vault load.
    const cwd = readAppConfigValue<string>('lastVaultPath')
    if (cwd === null) return { ok: false }
    return getSpawner().input(threadId, identity, text, cwd)
  })

  typedHandle('cli-thread:close', async ({ threadId }) => {
    getSpawner().close(threadId)
  })

  typedHandle('cli-thread:cancel', async ({ threadId }) => {
    const ok = getSpawner().cancel(threadId)
    return { ok }
  })
}
