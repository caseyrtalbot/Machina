import { typedHandle } from '../typed-ipc'
import { CliThreadSpawner } from '../services/cli-thread-spawner'
import { getCliTurnRegistry, setPtyAliveProbe } from '../services/cli-turn-registry'
import { getCliAgentThreadBridge, getShellService } from './shell'

let spawner: CliThreadSpawner | null = null

function getSpawner(): CliThreadSpawner {
  if (!spawner) {
    spawner = new CliThreadSpawner({
      shellService: getShellService(),
      bridge: getCliAgentThreadBridge(),
      // Gate-parity attribution (step 3): turn windows open on send, close on
      // block completion (wired in ipc/shell.ts), drop on thread close.
      registry: getCliTurnRegistry()
    })
    // Late-bound to break the shell.ts ↔ cli-thread.ts cycle: the registry's
    // degraded-mode window is "this thread's PTY is still alive".
    const bound = spawner
    setPtyAliveProbe((threadId) => bound.hasLiveSession(threadId))
  }
  return spawner
}

export function registerCliThreadIpc(): void {
  typedHandle('cli-thread:spawn', async ({ threadId, identity, cwd, agentId }) => {
    return getSpawner().spawn(threadId, identity, cwd, agentId)
  })

  typedHandle('cli-thread:input', async ({ threadId, identity, text, cwd, agentId }) => {
    // Spawn-on-demand: the spawner's threadId → sessionId map is in-memory,
    // so persisted threads have no session after a relaunch. The renderer
    // supplies the per-turn cwd (workspace root) — main holds no vault-path
    // config read on this path.
    return getSpawner().input(threadId, identity, text, cwd, agentId)
  })

  typedHandle('cli-thread:close', async ({ threadId }) => {
    getSpawner().close(threadId)
  })

  typedHandle('cli-thread:cancel', async ({ threadId }) => {
    const ok = getSpawner().cancel(threadId)
    return { ok }
  })
}
