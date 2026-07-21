/**
 * Canvas auto-save: debounced persistence of canvas state to disk.
 * Single autosaver for ALL canvas instances — wired once, on the first
 * canvas surface mount (ensureCanvasAutosave), never torn down: the store
 * registry outlives views, and app-level listeners (agent plans) can dirty
 * a store whose canvas tab is closed.
 *
 * Mirrors the vault-persist pattern, per store instance (3.8 multi-canvas):
 * - 2s debounce after any canvas mutation (isDirty becomes true)
 * - Pan-end (isInteracting falling edge) saves viewport drift without
 *   dirtying every pan frame
 * - Version-safe: a mutation landing mid-save keeps the canvas dirty
 *   (markSaved no-ops) and reschedules instead of being lost
 * - Flush on app quit (via app:will-quit) covers every loaded instance,
 *   not just the active canvas
 * - Subscribe/unsubscribe lifecycle managed by caller; instances created
 *   after subscription (new canvas tabs) are picked up via the registry
 */

import {
  getAllCanvasStores,
  onCanvasStoreCreated,
  type CanvasStore,
  type CanvasStoreApi
} from './canvas-store'
import { saveCanvas } from '../panels/canvas/canvas-io'
import { logError, notifyError } from '../utils/error-logger'

const AUTOSAVE_DEBOUNCE_MS = 2000

const autosaveTimers = new Map<CanvasStoreApi, ReturnType<typeof setTimeout>>()

function viewportDrifted(state: CanvasStore): boolean {
  const { viewport, savedViewport } = state
  if (!savedViewport) return false
  return (
    viewport.x !== savedViewport.x ||
    viewport.y !== savedViewport.y ||
    viewport.zoom !== savedViewport.zoom
  )
}

async function performSave(store: CanvasStoreApi): Promise<void> {
  const state = store.getState()
  if (!state.filePath) return
  if (!state.isDirty && !viewportDrifted(state)) return

  const version = state.dirtyVersion
  const canvasFile = state.toCanvasFile()
  try {
    await saveCanvas(state.filePath, canvasFile)
    state.markSaved(version, canvasFile.viewport)
    // A mutation landed mid-save: markSaved no-oped, keep the loop alive.
    if (store.getState().isDirty) scheduleAutosave(store)
  } catch (err) {
    notifyError('canvas-autosave', err, 'Failed to save canvas')
  }
}

/**
 * Debounced save request. Exported for the file-lifecycle hook: when a canvas
 * gains its filePath after content already exists, isDirty is already true so
 * the rising-edge watcher below never fires — the adopter asks explicitly.
 */
export function scheduleAutosave(store: CanvasStoreApi): void {
  const existing = autosaveTimers.get(store)
  if (existing !== undefined) clearTimeout(existing)
  autosaveTimers.set(
    store,
    setTimeout(() => {
      autosaveTimers.delete(store)
      void performSave(store)
    }, AUTOSAVE_DEBOUNCE_MS)
  )
}

function clearTimer(store: CanvasStoreApi): void {
  const timer = autosaveTimers.get(store)
  if (timer !== undefined) {
    clearTimeout(timer)
    autosaveTimers.delete(store)
  }
}

/**
 * Flush every canvas instance to disk immediately (for quit/unload).
 * Also persists a drifted viewport even when a canvas is otherwise clean.
 */
export async function flushCanvasSave(): Promise<void> {
  const stores = [...getAllCanvasStores().values()]
  for (const store of stores) clearTimer(store)
  await Promise.all(
    stores.map(async (store) => {
      try {
        // Drain, don't single-pass: a mutation landing mid-save keeps the
        // store dirty and performSave reschedules a debounced retry that a
        // quitting app would never run. Bounded so a persistently failing
        // save (performSave swallows errors) cannot loop forever.
        for (let attempt = 0; attempt < 3; attempt++) {
          await performSave(store)
          clearTimer(store)
          const state = store.getState()
          if (!state.filePath || !state.isDirty) break
        }
      } catch (err) {
        logError('canvas-flush', err)
      }
    })
  )
}

function watchStore(store: CanvasStoreApi): () => void {
  let prevDirty = store.getState().isDirty
  let prevInteracting = store.getState().isInteracting

  return store.subscribe((state) => {
    if (state.isDirty && !prevDirty) {
      scheduleAutosave(store)
    }
    // Pan-end: persist viewport drift without dirtying every pan frame.
    if (prevInteracting && !state.isInteracting && viewportDrifted(state)) {
      scheduleAutosave(store)
    }
    prevDirty = state.isDirty
    prevInteracting = state.isInteracting
  })
}

/**
 * Subscribe every canvas store (existing and future) and auto-save when one
 * becomes dirty, or when a pan/zoom interaction ends with the viewport moved.
 * Returns an unsubscribe function.
 */
export function subscribeCanvasAutosave(): () => void {
  const unsubs: Array<() => void> = []
  for (const store of getAllCanvasStores().values()) unsubs.push(watchStore(store))
  unsubs.push(onCanvasStoreCreated((_id, store) => unsubs.push(watchStore(store))))

  return () => {
    for (const unsub of unsubs) unsub()
    unsubs.length = 0
    for (const timer of autosaveTimers.values()) clearTimeout(timer)
    autosaveTimers.clear()
  }
}

let autosaveWired = false

/**
 * Idempotent app-lifetime wiring, called from the canvas surface's mount.
 * Deliberately never unsubscribed: stores stay in the registry after their
 * canvas tab closes and can still be dirtied (e.g. an accepted agent plan),
 * so the watcher must outlive any individual CanvasView.
 */
export function ensureCanvasAutosave(): void {
  if (autosaveWired) return
  autosaveWired = true
  subscribeCanvasAutosave()
}
