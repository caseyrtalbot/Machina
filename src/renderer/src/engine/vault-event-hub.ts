/**
 * VaultEventHub — Renderer-side singleton that receives batched file-change
 * events from main process and dispatches to path-indexed subscribers.
 *
 * IPC is crossed exactly once per batch. Components subscribe to the hub,
 * not IPC directly. This fixes the dead `vault:file-changed` channel issue
 * where main only emits `vault:files-changed-batch` but components subscribed
 * to the never-emitted individual channel.
 *
 *   Main (batch IPC) → VaultEventHub → path-indexed dispatch → components
 */

export interface FileChangeEvent {
  readonly path: string
  readonly event: 'add' | 'change' | 'unlink'
}

type FileListener = (event: FileChangeEvent) => void
type BatchListener = (events: readonly FileChangeEvent[]) => void

class VaultEventHub {
  private readonly batchListeners = new Set<BatchListener>()
  private readonly anyListeners = new Set<FileListener>()
  private readonly byPath = new Map<string, Set<FileListener>>()
  private unsubscribeIpc: (() => void) | null = null

  /** Lazily subscribe to IPC on first listener registration. */
  private ensureStarted(): void {
    if (this.unsubscribeIpc) return
    this.unsubscribeIpc = window.api.on.filesChangedBatch((data) => {
      const events = data.events as readonly FileChangeEvent[]
      if (events.length === 0) return

      // Batch listeners first (App.tsx vault re-indexing)
      for (const listener of [...this.batchListeners]) {
        listener(events)
      }

      // Per-event dispatch: any-listeners + path-specific listeners
      for (const event of events) {
        for (const listener of [...this.anyListeners]) {
          listener(event)
        }
        const pathListeners = this.byPath.get(event.path)
        if (pathListeners) {
          for (const listener of [...pathListeners]) {
            listener(event)
          }
        }
      }
    })
  }

  /** Subscribe to all events as a batch (for vault re-indexing). */
  subscribeBatch(listener: BatchListener): () => void {
    this.ensureStarted()
    this.batchListeners.add(listener)
    return () => {
      this.batchListeners.delete(listener)
    }
  }

  /** Subscribe to every individual file event (for sidebar updates). */
  subscribeAny(listener: FileListener): () => void {
    this.ensureStarted()
    this.anyListeners.add(listener)
    return () => {
      this.anyListeners.delete(listener)
    }
  }

  /** Subscribe to events for a specific file path (for FileViewCard, EditorPanel). */
  subscribePath(path: string, listener: FileListener): () => void {
    this.ensureStarted()
    let listeners = this.byPath.get(path)
    if (!listeners) {
      listeners = new Set<FileListener>()
      this.byPath.set(path, listeners)
    }
    listeners.add(listener)
    return () => {
      const current = this.byPath.get(path)
      if (!current) return
      current.delete(listener)
      if (current.size === 0) {
        this.byPath.delete(path)
      }
    }
  }
}

/** Singleton instance — import this in components. */
export const vaultEvents = new VaultEventHub()
