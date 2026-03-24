import type { BrowserWindow } from 'electron'
import { VaultWatcher } from '../services/vault-watcher'
import { FileService } from '../services/file-service'
import { teConfigPath } from '../utils/paths'
import { typedHandle, typedSend } from '../typed-ipc'
import { getDocumentManager } from './documents'

const watcher = new VaultWatcher()
const fileService = new FileService()

export function registerWatcherIpc(mainWindow: BrowserWindow): void {
  typedHandle('vault:watch-start', async (args) => {
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
      (events) => {
        typedSend(mainWindow, 'vault:files-changed-batch', { events })

        // Route change events to DocumentManager for open files
        const docManager = getDocumentManager()
        for (const { path, event } of events) {
          if (event === 'change' && docManager.documents.has(path)) {
            docManager.handleExternalChange(path).catch(() => {})
          }
        }
      },
      customPatterns
    )
  })

  typedHandle('vault:watch-stop', async () => {
    await watcher.stop()
  })
}
