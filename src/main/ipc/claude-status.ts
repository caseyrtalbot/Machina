import { typedHandle, typedSend } from '../typed-ipc'
import { getMainWindow } from '../window-registry'
import type { ClaudeStatusService } from '../services/claude-status-service'

export function registerClaudeStatusIpc(service: ClaudeStatusService): void {
  typedHandle('claude:get-status', () => service.getStatus())
  typedHandle('claude:recheck', () => service.check())

  service.setOnChange((status) => {
    const window = getMainWindow()
    if (window) typedSend(window, 'claude:status-changed', status)
  })
}
