import type { BrowserWindow } from 'electron'
import { ShellService } from '../services/shell-service'
import { typedHandle, typedSend } from '../typed-ipc'
import { sessionId } from '@shared/types'

const shellService = new ShellService()

const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/

function assertValidSessionId(id: string): void {
  if (!SESSION_ID_PATTERN.test(id)) {
    throw new Error(`Invalid sessionId format: ${id.slice(0, 20)}`)
  }
}

export function registerShellIpc(mainWindow: BrowserWindow): void {
  shellService.setCallbacks(
    (sessionId, data) => {
      typedSend(mainWindow, 'terminal:data', { sessionId, data })
    },
    (sessionId, code) => {
      typedSend(mainWindow, 'terminal:exit', { sessionId, code })
    }
  )

  typedHandle('terminal:create', async (args) => {
    return shellService.create(args.cwd, args.shell, args.label, args.vaultPath)
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

  typedHandle('terminal:reconnect', async (args) => {
    assertValidSessionId(args.sessionId)
    return shellService.reconnect(args.sessionId, args.cols, args.rows)
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
