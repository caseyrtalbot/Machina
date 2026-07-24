import { typedHandle, typedSend } from '../typed-ipc'
import { getMainWindow } from '../window-registry'
import { getIndexSnapshot, type LiveIndexDeps } from '../services/vault-indexing'
import type { VaultIndexDelta } from '@shared/index-delta'

/**
 * Main-process index authority IPC: serves the parsed index snapshot and emits
 * parsed deltas after each watcher batch. The renderer consumes these instead
 * of re-parsing the vault (one parse authority: the main process).
 */

// Active vault's deps, re-pointed on every vault switch (like the PDF index and
// live updater). Null before the first vault init; snapshot then serves empty.
let currentDeps: LiveIndexDeps | null = null

/** Point the snapshot handler at the active vault's deps (null detaches). */
export function setVaultIndexSnapshotDeps(deps: LiveIndexDeps | null): void {
  currentDeps = deps
}

/** Emit a parsed index delta to the renderer window (survives watcher restarts). */
export function emitIndexDelta(delta: VaultIndexDelta): void {
  const window = getMainWindow()
  if (window) typedSend(window, 'vault:index-delta', delta)
}

export function registerVaultIndexIpc(): void {
  typedHandle('vault:index-snapshot', () => {
    if (!currentDeps) return { entries: [] }
    return getIndexSnapshot(currentDeps)
  })
}
