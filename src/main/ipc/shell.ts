import type { BrowserWindow } from 'electron'
import { ShellService } from '../services/shell-service'
import { typedHandle, typedSend } from '../typed-ipc'
import { sessionId } from '@shared/types'

const shellService = new ShellService()

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
    shellService.write(args.sessionId, args.data)
  })

  typedHandle('terminal:resize', async (args) => {
    shellService.resize(args.sessionId, args.cols, args.rows)
  })

  typedHandle('terminal:kill', async (args) => {
    shellService.kill(args.sessionId)
  })

  typedHandle('terminal:process-name', async (args) => {
    return shellService.getProcessName(args.sessionId)
  })

  typedHandle('terminal:reconnect', async (args) => {
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
