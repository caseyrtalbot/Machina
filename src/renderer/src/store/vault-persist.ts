import type { VaultState, UiPersistedState } from '@shared/types'
import { notifyError } from '../utils/error-logger'
import { flushCanvasSave } from './canvas-autosave'
import { useVaultStore } from './vault-store'
import { flushPendingSave, useEditorStore } from './editor-store'
import { useViewStore } from './view-store'

const DEFAULT_UI_STATE: UiPersistedState = {
  backlinkCollapsed: {},
  dismissedGhosts: [],
  outlineVisible: false,
  bookmarkedPaths: []
}

let uiState: UiPersistedState = { ...DEFAULT_UI_STATE }
let persistTimer: ReturnType<typeof setTimeout> | null = null

const DEBOUNCE_MS = 1000

export function getUiState(): UiPersistedState {
  return uiState
}

export function setUiState(next: UiPersistedState): void {
  uiState = next
  schedulePersist()
}

export function updateUiState(partial: Partial<UiPersistedState>): void {
  uiState = { ...uiState, ...partial }
  schedulePersist()
}

/**
 * Rehydrate ui state from the loaded VaultState.
 * Call after orchestrateLoad completes.
 */
export function rehydrateUiState(): void {
  const state = useVaultStore.getState().state
  if (state?.ui) {
    uiState = { ...DEFAULT_UI_STATE, ...state.ui }
  } else {
    uiState = { ...DEFAULT_UI_STATE }
  }
}

/**
 * Gather current state from all stores into a VaultState object.
 */
const PERSISTABLE_VIEWS = new Set(['editor', 'canvas'])

function gatherVaultState(): VaultState {
  const vault = useVaultStore.getState()
  const editor = useEditorStore.getState()
  const view = useViewStore.getState()
  const existing = vault.state
  const contentView = PERSISTABLE_VIEWS.has(view.contentView)
    ? (view.contentView as VaultState['contentView'])
    : (existing?.contentView ?? 'editor')

  return {
    version: existing?.version ?? 1,
    lastOpenNote: editor.activeNotePath,
    panelLayout: { sidebarWidth: existing?.panelLayout?.sidebarWidth ?? 280 },
    contentView,
    fileTreeCollapseState: existing?.fileTreeCollapseState ?? {},
    selectedNodeId: existing?.selectedNodeId ?? null,
    recentFiles: existing?.recentFiles ?? [],
    ui: uiState
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
  // Fire-and-forget: best-effort persist on close (Slice 2 will add coordinated quit)
  window.api.vault
    .writeState(vaultPath, state)
    .catch((err) =>
      notifyError('vault-persist-flush', err, 'Failed to save workspace state on close')
    )
}

/**
 * Coordinated quit handler. Called by main process via `app:will-quit` event.
 * Awaits the vault state write, then signals main that it's safe to quit.
 */
export function registerQuitHandler(): () => void {
  return window.api.on.appWillQuit(async () => {
    if (persistTimer !== null) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    await Promise.all([writePersist(), flushCanvasSave(), flushPendingSave()])
    window.api.lifecycle.quitReady()
  })
}

/**
 * Subscribe to store changes and auto-persist.
 * Uses shallow comparison on the fields we care about to avoid redundant writes.
 * Returns an unsubscribe function.
 */
export function subscribeVaultPersist(): () => void {
  let prevNotePath = useEditorStore.getState().activeNotePath
  let prevContentView = useViewStore.getState().contentView

  const unsubs = [
    useEditorStore.subscribe((state) => {
      if (state.activeNotePath !== prevNotePath) {
        prevNotePath = state.activeNotePath
        schedulePersist()
      }
    }),
    useViewStore.subscribe((state) => {
      if (state.contentView !== prevContentView) {
        prevContentView = state.contentView
        schedulePersist()
      }
    })
  ]

  return () => unsubs.forEach((unsub) => unsub())
}
