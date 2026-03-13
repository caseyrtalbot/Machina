import { ipcMain, type BrowserWindow } from 'electron'
import { ShellService } from '../services/shell-service'

const shellService = new ShellService()

export function registerShellIpc(mainWindow: BrowserWindow): void {
  shellService.setCallbacks(
    (sessionId, data) => mainWindow.webContents.send('terminal:data', { sessionId, data }),
    (sessionId, code) => mainWindow.webContents.send('terminal:exit', { sessionId, code })
  )

  ipcMain.handle('terminal:create', async (_e, args: { cwd: string; shell?: string }) => {
    return shellService.create(args.cwd, args.shell)
  })

  ipcMain.handle('terminal:write', async (_e, args: { sessionId: string; data: string }) => {
    shellService.write(args.sessionId, args.data)
  })

  ipcMain.handle(
    'terminal:resize',
    async (_e, args: { sessionId: string; cols: number; rows: number }) => {
      shellService.resize(args.sessionId, args.cols, args.rows)
    }
  )

  ipcMain.handle('terminal:kill', async (_e, args: { sessionId: string }) => {
    shellService.kill(args.sessionId)
  })
}

export function getShellService(): ShellService {
  return shellService
}
