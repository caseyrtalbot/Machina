import { useEffect, useRef } from 'react'
import { useStore } from 'zustand'
import { TE_DIR } from '@shared/constants'
import { DEFAULT_CANVAS_ID, getCanvasStore } from '../../store/canvas-store'
import { useVaultStore } from '../../store/vault-store'
import { scheduleAutosave } from '../../store/canvas-autosave'
import { loadCanvasFromDisk } from './canvas-io'

export { DEFAULT_CANVAS_ID } from '../../store/canvas-store'

function canvasFilePath(vaultPath: string, canvasId: string): string {
  if (canvasId === DEFAULT_CANVAS_ID) return `${vaultPath}/${TE_DIR}/canvas.json`
  return `${vaultPath}/${TE_DIR}/canvas/${canvasId}.json`
}

/**
 * Per-canvasId load/ensure-file lifecycle (3.8): each mounted canvas binds to
 * its own store instance, so two open canvases hold independent state.
 */
export function useCanvasFileLifecycle(canvasId: string): void {
  const store = getCanvasStore(canvasId)
  const nodes = useStore(store, (s) => s.nodes)
  const edges = useStore(store, (s) => s.edges)
  const filePath = useStore(store, (s) => s.filePath)
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const didLoadCanvas = useRef(false)
  const didEnsureFile = useRef(false)
  const hasContent = nodes.length > 0 || edges.length > 0

  useEffect(() => {
    if (didLoadCanvas.current || filePath || !vaultPath) return
    didLoadCanvas.current = true

    void (async () => {
      const defaultPath = canvasFilePath(vaultPath, canvasId)
      try {
        const exists = await window.api.fs.fileExists(defaultPath)
        if (exists) {
          // Returns null (after .bak + user notification) on corrupt JSON —
          // never load an empty canvas over a corrupt file.
          const file = await loadCanvasFromDisk(defaultPath)
          if (file) store.getState().loadCanvas(defaultPath, file)
        }
      } catch {
        // Non-fatal: canvas works without persistence.
      }
    })()
  }, [canvasId, filePath, vaultPath, store])

  useEffect(() => {
    if (didEnsureFile.current || filePath || !vaultPath || !hasContent) return
    didEnsureFile.current = true

    void (async () => {
      const defaultPath = canvasFilePath(vaultPath, canvasId)
      try {
        const dirPath =
          canvasId === DEFAULT_CANVAS_ID
            ? `${vaultPath}/${TE_DIR}`
            : `${vaultPath}/${TE_DIR}/canvas`
        await window.api.fs.mkdir(dirPath)
        // Adopt the path and let the autosaver write the REAL in-memory
        // content (version-safe). Writing an empty createCanvasFile() and
        // loadCanvas()-ing over it cleared isDirty while the disk file was
        // empty — quitting before the next mutation lost every card.
        store.setState((s) => ({
          filePath: defaultPath,
          isDirty: true,
          dirtyVersion: s.dirtyVersion + 1
        }))
        scheduleAutosave(store)
      } catch {
        // Non-fatal.
      }
    })()
  }, [canvasId, filePath, vaultPath, hasContent, store])

  // Saving is owned by the App-level canvas autosaver (subscribeCanvasAutosave),
  // which watches every registry instance and has quit-flush integration —
  // no competing save effect here.
}
