import type { VaultState, UiPersistedState } from '@shared/types'
import { notifyError } from '../utils/error-logger'
import { flushCanvasSave } from './canvas-autosave'
import { useVaultStore } from './vault-store'
import { flushPendingSave, useEditorStore } from './editor-store'

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
const MAX_RECENT_FILES = 50

function buildRecentFiles(historyStack: readonly string[], existing: readonly string[]): string[] {
  // Walk history newest-first, then append persisted entries not already seen
  const seen = new Set<string>()
  const result: string[] = []
  for (let i = historyStack.length - 1; i >= 0; i--) {
    const path = historyStack[i]
    if (!seen.has(path)) {
      seen.add(path)
      result.push(path)
    }
  }
  for (const path of existing) {
    if (!seen.has(path)) {
      seen.add(path)
      result.push(path)
    }
  }
  return result.slice(0, MAX_RECENT_FILES)
}

function gatherVaultState(): VaultState {
  const vault = useVaultStore.getState()
  const editor = useEditorStore.getState()
  const existing = vault.state

  return {
    version: existing?.version ?? 1,
    lastOpenNote: editor.activeNotePath,
    panelLayout: { sidebarWidth: existing?.panelLayout?.sidebarWidth ?? 280 },
    fileTreeCollapseState: existing?.fileTreeCollapseState ?? {},
    selectedNodeId: existing?.selectedNodeId ?? null,
    recentFiles: buildRecentFiles(editor.historyStack, existing?.recentFiles ?? []),
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

  const unsub = useEditorStore.subscribe((state) => {
    if (state.activeNotePath !== prevNotePath) {
      prevNotePath = state.activeNotePath
      schedulePersist()
    }
  })

  return unsub
}
