import { useEffect, useRef } from 'react'
import { TE_DIR } from '@shared/constants'
import { useCanvasStore } from '../../store/canvas-store'
import { useVaultStore } from '../../store/vault-store'
import { deserializeCanvas, saveCanvas } from './canvas-io'

export const DEFAULT_CANVAS_ID = 'default'

function canvasFilePath(vaultPath: string, canvasId: string): string {
  if (canvasId === DEFAULT_CANVAS_ID) return `${vaultPath}/${TE_DIR}/canvas.json`
  return `${vaultPath}/${TE_DIR}/canvas/${canvasId}.json`
}

export function useCanvasFileLifecycle(canvasId: string): void {
  const nodes = useCanvasStore((s) => s.nodes)
  const edges = useCanvasStore((s) => s.edges)
  const filePath = useCanvasStore((s) => s.filePath)
  const isDirty = useCanvasStore((s) => s.isDirty)
  const toCanvasFile = useCanvasStore((s) => s.toCanvasFile)
  const markSaved = useCanvasStore((s) => s.markSaved)
  const loadCanvas = useCanvasStore((s) => s.loadCanvas)
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
          const raw = await window.api.fs.readFile(defaultPath)
          loadCanvas(defaultPath, deserializeCanvas(raw))
        }
      } catch {
        // Non-fatal: canvas works without persistence.
      }
    })()
  }, [canvasId, filePath, vaultPath, loadCanvas])

  useEffect(() => {
    if (didEnsureFile.current || filePath || !vaultPath || !hasContent) return
    didEnsureFile.current = true

    void (async () => {
      const defaultPath = canvasFilePath(vaultPath, canvasId)
      try {
        const { createCanvasFile } = await import('@shared/canvas-types')
        const data = createCanvasFile()
        const dirPath =
          canvasId === DEFAULT_CANVAS_ID
            ? `${vaultPath}/${TE_DIR}`
            : `${vaultPath}/${TE_DIR}/canvas`
        await window.api.fs.mkdir(dirPath)
        await window.api.fs.writeFile(defaultPath, JSON.stringify(data, null, 2))
        loadCanvas(defaultPath, { ...data, ...toCanvasFile() })
      } catch {
        // Non-fatal.
      }
    })()
  }, [canvasId, filePath, vaultPath, hasContent, loadCanvas, toCanvasFile])

  useEffect(() => {
    if (!filePath || !isDirty) return
    const timer = setTimeout(async () => {
      await saveCanvas(filePath, toCanvasFile())
      markSaved()
    }, 500)
    return () => clearTimeout(timer)
  }, [filePath, isDirty, toCanvasFile, markSaved])
}
