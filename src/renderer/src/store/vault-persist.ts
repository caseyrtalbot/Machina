import type { VaultState } from '@shared/types'
import { logError, notifyError } from '../utils/error-logger'
import { flushCanvasSave } from './canvas-autosave'
import { useVaultStore } from './vault-store'
import { flushPendingSave, useEditorStore } from './editor-store'
import { rehydrateUiStore, useUiStore } from './ui-store'
import { useThreadStore } from './thread-store'
import { flushDockState } from './dock-store'

let persistTimer: ReturnType<typeof setTimeout> | null = null

const DEBOUNCE_MS = 1000

/**
 * Rehydrate persisted UI state from the loaded VaultState.
 * Deprecated alias for ui-store's rehydrateUiStore — ui-store is the single
 * owner now. Kept so the remaining App.tsx caller compiles; drop both calls
 * there in favor of rehydrateUiStore alone when App is next touched.
 */
export function rehydrateUiState(): void {
  rehydrateUiStore()
}

/**
 * Gather current state from all stores into a VaultState object.
 * ui-store is the single owner of persisted UI state.
 */
function gatherVaultState(): VaultState {
  const vault = useVaultStore.getState()
  const editor = useEditorStore.getState()
  const ui = useUiStore.getState()

  return {
    version: vault.state?.version ?? 1,
    lastOpenNote: editor.activeNotePath,
    fileTreeCollapseState: { ...ui.fileTreeCollapseState },
    ui: {
      backlinkCollapsed: { ...ui.backlinkCollapsed },
      dismissedGhosts: [...ui.dismissedGhosts],
      outlineVisible: ui.outlineVisible,
      bookmarkedPaths: [...ui.bookmarkedPaths],
      graphTutorialDismissed: ui.graphTutorialDismissed
    }
  }
}

function schedulePersist(): void {
  if (persistTimer !== null) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    void writePersist()
  }, DEBOUNCE_MS)
}

async function writePersist(): Promise<void> {
  const vaultPath = useVaultStore.getState().vaultPath
  if (!vaultPath) return
  const state = gatherVaultState()
  useVaultStore.getState().setState(state)
  try {
    await window.api.vault.writeState(vaultPath, state)
  } catch (err) {
    console.error('Failed to persist vault state:', err)
  }
}

/**
 * Flush state immediately (for beforeunload).
 * Uses synchronous scheduling since beforeunload cannot await.
 */
export function flushVaultState(): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  const vaultPath = useVaultStore.getState().vaultPath
  if (!vaultPath) return
  const state = gatherVaultState()
  useVaultStore.getState().setState(state)
  // Fire-and-forget: best-effort persist on close (coordinated quit awaits properly)
  window.api.vault
    .writeState(vaultPath, state)
    .catch((err) =>
      notifyError('vault-persist-flush', err, 'Failed to save workspace state on close')
    )
}

/**
 * Coordinated quit handler. Called by main process via `app:will-quit` event.
 * Awaits every flush (vault state, canvas, dirty docs, active thread's dock
 * tabs), then signals main that it's safe to quit. A failed flush must not
 * block quit — main's budget times out regardless, but failing fast keeps the
 * shutdown deterministic.
 */
export function registerQuitHandler(): () => void {
  return window.api.on.appWillQuit(async () => {
    if (persistTimer !== null) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    const activeThreadId = useThreadStore.getState().activeThreadId
    try {
      await Promise.all([
        writePersist(),
        flushCanvasSave(),
        flushPendingSave(),
        ...(activeThreadId ? [flushDockState(activeThreadId)] : [])
      ])
    } catch (err) {
      logError('quit-flush', err)
    }
    window.api.lifecycle.quitReady()
  })
}

/**
 * Subscribe to store changes and auto-persist.
 * Editor: persists when the active note changes. Ui-store: every change is
 * persisted state (collapse maps, bookmarks, dismissals), so any change
 * schedules a debounced write.
 * Returns an unsubscribe function.
 */
export function subscribeVaultPersist(): () => void {
  let prevNotePath = useEditorStore.getState().activeNotePath

  const unsubEditor = useEditorStore.subscribe((state) => {
    if (state.activeNotePath !== prevNotePath) {
      prevNotePath = state.activeNotePath
      schedulePersist()
    }
  })

  const unsubUi = useUiStore.subscribe(() => schedulePersist())

  return () => {
    unsubEditor()
    unsubUi()
  }
}
