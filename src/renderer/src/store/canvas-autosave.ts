/**
 * Canvas auto-save: debounced persistence of canvas state to disk.
 * Single autosaver for the canvas — wired once at the App level.
 *
 * Mirrors the vault-persist pattern:
 * - 2s debounce after any canvas mutation (isDirty becomes true)
 * - Pan-end (isInteracting falling edge) saves viewport drift without
 *   dirtying every pan frame
 * - Version-safe: a mutation landing mid-save keeps the canvas dirty
 *   (markSaved no-ops) and reschedules instead of being lost
 * - Flush on app quit (via app:will-quit)
 * - Subscribe/unsubscribe lifecycle managed by caller
 */

import { useCanvasStore } from './canvas-store'
import { saveCanvas } from '../panels/canvas/canvas-io'
import { logError, notifyError } from '../utils/error-logger'

const AUTOSAVE_DEBOUNCE_MS = 2000

let autosaveTimer: ReturnType<typeof setTimeout> | null = null

type CanvasState = ReturnType<typeof useCanvasStore.getState>

function viewportDrifted(state: CanvasState): boolean {
  const { viewport, savedViewport } = state
  if (!savedViewport) return false
  return (
    viewport.x !== savedViewport.x ||
    viewport.y !== savedViewport.y ||
    viewport.zoom !== savedViewport.zoom
  )
}

async function performSave(): Promise<void> {
  const state = useCanvasStore.getState()
  if (!state.filePath) return
  if (!state.isDirty && !viewportDrifted(state)) return

  const version = state.dirtyVersion
  const canvasFile = state.toCanvasFile()
  try {
    await saveCanvas(state.filePath, canvasFile)
    state.markSaved(version, canvasFile.viewport)
    // A mutation landed mid-save: markSaved no-oped, keep the loop alive.
    if (useCanvasStore.getState().isDirty) scheduleAutosave()
  } catch (err) {
    notifyError('canvas-autosave', err, 'Failed to save canvas')
  }
}

function scheduleAutosave(): void {
  if (autosaveTimer !== null) clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null
    void performSave()
  }, AUTOSAVE_DEBOUNCE_MS)
}

/**
 * Flush canvas to disk immediately (for quit/unload).
 * Also persists a drifted viewport even when the canvas is otherwise clean.
 */
export async function flushCanvasSave(): Promise<void> {
  if (autosaveTimer !== null) {
    clearTimeout(autosaveTimer)
    autosaveTimer = null
  }
  try {
    await performSave()
  } catch (err) {
    logError('canvas-flush', err)
  }
}

/**
 * Subscribe to canvas store changes and auto-save when dirty,
 * or when a pan/zoom interaction ends with the viewport moved.
 * Returns an unsubscribe function.
 */
export function subscribeCanvasAutosave(): () => void {
  let prevDirty = useCanvasStore.getState().isDirty
  let prevInteracting = useCanvasStore.getState().isInteracting

  const unsub = useCanvasStore.subscribe((state) => {
    if (state.isDirty && !prevDirty) {
      scheduleAutosave()
    }
    // Pan-end: persist viewport drift without dirtying every pan frame.
    if (prevInteracting && !state.isInteracting && viewportDrifted(state)) {
      scheduleAutosave()
    }
    prevDirty = state.isDirty
    prevInteracting = state.isInteracting
  })

  return () => {
    unsub()
    if (autosaveTimer !== null) {
      clearTimeout(autosaveTimer)
      autosaveTimer = null
    }
  }
}
