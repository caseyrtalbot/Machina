import { VaultWatcher } from '../services/vault-watcher'
import { FileService } from '../services/file-service'
import { teConfigPath } from '../utils/paths'
import { typedHandle, typedSend } from '../typed-ipc'
import { getDocumentManager } from './documents'
import { getMainWindow } from '../window-registry'

const watcher = new VaultWatcher()
const fileService = new FileService()

export function registerWatcherIpc(): void {
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
        const window = getMainWindow()
        if (window) {
          typedSend(window, 'vault:files-changed-batch', { events })
        }

        // Route change events to DocumentManager for open files
        const docManager = getDocumentManager()
        for (const { path, event } of events) {
          if (event === 'change' && docManager.documents.has(path)) {
            docManager.handleExternalChange(path).catch((err) => {
              console.error(`[watcher] Failed to handle external change for ${path}:`, err)
            })
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

export function getVaultWatcher(): VaultWatcher {
  return watcher
}
