import type { PtyMonitor } from '../services/pty-monitor'
import type { AgentSpawner } from '../services/agent-spawner'
import { typedHandle, typedSend } from '../typed-ipc'
import { getMainWindow } from '../window-registry'

let activeMonitor: PtyMonitor | null = null
let activeSpawner: AgentSpawner | null = null

export function registerAgentIpc(): void {
  typedHandle('agent:get-states', async () => {
    const ptyStates = activeMonitor ? activeMonitor.getAgentStates() : []
    return ptyStates
  })

  typedHandle('agent:spawn', async (request) => {
    if (!activeSpawner) return { error: 'Agent spawner not available' }

    const sessionId = activeSpawner.spawn(request)
    return { sessionId }
  })

  typedHandle('agent:kill', async (_payload) => {
    // Deliberate stub. The sidecar process model was removed; PTY sessions are
    // killed via shell:kill. This channel is retained so existing renderer call
    // sites keep typechecking until they migrate. New code must not use it.
  })
}

export function setAgentServices(monitor: PtyMonitor | null, spawner: AgentSpawner | null): void {
  activeMonitor?.stop()

  activeMonitor = monitor
  activeSpawner = spawner

  if (monitor) {
    monitor.start((ptyStates) => {
      const window = getMainWindow()
      if (window) {
        typedSend(window, 'agent:states-changed', {
          states: ptyStates
        })
      }
    })
  }
}

export function stopAgentServices(): void {
  activeMonitor?.stop()
  activeMonitor = null
  activeSpawner = null
}
