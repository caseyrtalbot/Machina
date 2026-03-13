import { ipcMain, type BrowserWindow } from 'electron'
import { VaultWatcher } from '../services/vault-watcher'
import { FileService } from '../services/file-service'
import { teConfigPath } from '../utils/paths'

const watcher = new VaultWatcher()
const fileService = new FileService()

export function registerWatcherIpc(mainWindow: BrowserWindow): void {
  ipcMain.handle('vault:watch-start', async (_e, args: { vaultPath: string }) => {
    let customPatterns: string[] = []
    try {
      const configContent = await fileService.readFile(teConfigPath(args.vaultPath))
      const config = JSON.parse(configContent)
      customPatterns = config?.watcher?.ignorePatterns ?? []
    } catch {
      // Config doesn't exist or is malformed; use defaults only
    }

    await watcher.start(
      args.vaultPath,
      (path, event) => {
        mainWindow.webContents.send('vault:file-changed', { path, event })
      },
      customPatterns
    )
  })

  ipcMain.handle('vault:watch-stop', async () => {
    await watcher.stop()
  })
}
