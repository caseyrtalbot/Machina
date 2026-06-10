import { VaultWatcher } from '../services/vault-watcher'
import type { BatchedEvent } from '../services/event-batcher'
import { typedHandle, typedSend } from '../typed-ipc'
import { getIgnorePatterns } from '../utils/vault-config'
import { getDocumentManager } from './documents'
import { getMainWindow } from '../window-registry'
import { recordFileChange } from './health'

const watcher = new VaultWatcher()

type BatchListener = (events: readonly BatchedEvent[]) => void

// Optional main-process subscriber for watcher batches (live MCP vault index).
// Module-level so it survives watcher restarts; set from reconfigureForVault.
let batchListener: BatchListener | null = null

export function setVaultBatchListener(listener: BatchListener | null): void {
  batchListener = listener
}

export function registerWatcherIpc(): void {
  typedHandle('vault:watch-start', async (args) => {
    const customPatterns = await getIgnorePatterns(args.vaultPath)

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

        recordFileChange()

        // Keep the main-process MCP index live (search/graph/ghosts).
        batchListener?.(events)
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
