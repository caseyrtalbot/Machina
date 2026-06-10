import type { PtyMonitor } from '../services/pty-monitor'
import { typedHandle, typedSend } from '../typed-ipc'
import { getMainWindow } from '../window-registry'

let activeMonitor: PtyMonitor | null = null

export function registerAgentIpc(): void {
  typedHandle('agent:get-states', async () => {
    return activeMonitor ? activeMonitor.getAgentStates() : []
  })
}

export function setAgentServices(monitor: PtyMonitor | null): void {
  activeMonitor?.stop()

  activeMonitor = monitor

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
}
