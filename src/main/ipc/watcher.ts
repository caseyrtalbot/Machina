import { ipcMain, type BrowserWindow } from 'electron'
import { VaultWatcher } from '../services/vault-watcher'

const watcher = new VaultWatcher()

export function registerWatcherIpc(mainWindow: BrowserWindow): void {
  ipcMain.handle('vault:watch-start', async (_e, args: { vaultPath: string }) => {
    await watcher.start(args.vaultPath, (path, event) => {
      mainWindow.webContents.send('vault:file-changed', { path, event })
    })
  })

  ipcMain.handle('vault:watch-stop', async () => {
    await watcher.stop()
  })
}
