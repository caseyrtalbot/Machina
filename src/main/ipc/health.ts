import { typedHandle, typedSend } from '../typed-ipc'
import { getMainWindow } from '../window-registry'
import type { VaultHealthMonitor } from '../services/vault-health-monitor'
import type { InfraHealth } from '@shared/engine/vault-health'

let monitor: VaultHealthMonitor | null = null

export function registerHealthIpc(): void {
  typedHandle('health:heartbeat', async (args) => {
    monitor?.recordWorkerHeartbeat(args.at)
  })

  typedHandle('health:request-tick', async () => {
    monitor?.requestTick()
  })
}

export function setHealthMonitor(m: VaultHealthMonitor): void {
  monitor = m
}

export function recordFileChange(): void {
  monitor?.recordFileChange()
}

export function emitHealthReport(health: InfraHealth): void {
  const window = getMainWindow()
  if (window) typedSend(window, 'health:report', health)
}
