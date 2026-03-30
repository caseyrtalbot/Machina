import { ShellService } from '../services/shell-service'
import { typedHandle, typedHandleWithEvent } from '../typed-ipc'
import { register, unregister, getWebContents } from '../services/session-router'
import { sessionId } from '@shared/types'

const shellService = new ShellService()

const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/

function assertValidSessionId(id: string): void {
  if (!SESSION_ID_PATTERN.test(id)) {
    throw new Error(`Invalid sessionId format: ${id.slice(0, 20)}`)
  }
}

export function registerShellIpc(): void {
  shellService.setCallbacks(
    (sessionId, data) => {
      const wc = getWebContents(sessionId)
      if (wc) wc.send('terminal:data', { sessionId, data })
    },
    (sessionId, code) => {
      const wc = getWebContents(sessionId)
      if (wc) wc.send('terminal:exit', { sessionId, code })
      unregister(sessionId)
    }
  )

  typedHandleWithEvent('terminal:create', (args, event) => {
    const result = shellService.create(args.cwd, args.shell, args.label, args.vaultPath)
    register(result, event.sender.id)
    return result
  })

  typedHandle('terminal:write', async (args) => {
    assertValidSessionId(args.sessionId)
    shellService.write(args.sessionId, args.data)
  })

  typedHandle('terminal:resize', async (args) => {
    assertValidSessionId(args.sessionId)
    shellService.resize(args.sessionId, args.cols, args.rows)
  })

  typedHandle('terminal:kill', async (args) => {
    assertValidSessionId(args.sessionId)
    shellService.kill(args.sessionId)
  })

  typedHandle('terminal:process-name', async (args) => {
    assertValidSessionId(args.sessionId)
    return shellService.getProcessName(args.sessionId)
  })

  typedHandleWithEvent('terminal:reconnect', (args, event) => {
    assertValidSessionId(args.sessionId)
    const result = shellService.reconnect(args.sessionId, args.cols, args.rows)
    if (result) {
      register(args.sessionId, event.sender.id)
    }
    return result
  })

  typedHandle('terminal:discover', async () => {
    const discovered = shellService.discover()
    return discovered.map((d) => ({
      sessionId: sessionId(d.sessionId),
      meta: d.meta
    }))
  })

  typedHandle('terminal:tmux-available', async () => {
    return shellService.tmuxAvailable
  })
}

export function getShellService(): ShellService {
  return shellService
}
