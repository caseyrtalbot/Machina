import { typedHandle } from '../typed-ipc'
import type { EmbedderService } from '../services/embedder-service'

/**
 * IPC for the opt-in local-embedding service (3.11). The service is created
 * per vault in reconfigureForVault; handlers are registered once at startup.
 * `desiredEnabled` bridges the startup race: if the renderer's settings sync
 * arrives before the vault index (and thus the service) exists, the flag is
 * applied as soon as the service attaches.
 */

let service: EmbedderService | null = null
let desiredEnabled = false

const DEFAULT_K = 8

/** Point the handlers at the active vault's service (null detaches). */
export function setEmbedderService(next: EmbedderService | null): void {
  service?.dispose()
  service = next
  if (next && desiredEnabled) {
    void next.setEnabled(true)
  }
}

export function registerEmbeddingsIpc(): void {
  typedHandle('embeddings:set-enabled', async ({ enabled }) => {
    desiredEnabled = enabled
    await service?.setEnabled(enabled)
  })
  typedHandle(
    'embeddings:status',
    () => service?.status() ?? { enabled: false, state: 'off' as const, docCount: 0 }
  )
  typedHandle('embeddings:search', ({ query, k }) => service?.search(query, k ?? DEFAULT_K) ?? [])
}
