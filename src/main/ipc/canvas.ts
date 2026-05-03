import { typedHandle, typedSend } from '../typed-ipc'
import { getMainWindow } from '../window-registry'
import { readFile, stat } from 'fs/promises'
import type { CanvasFile } from '@shared/canvas-types'
import { validateCanvasMutationOps } from '@shared/canvas-mutation-validation'

export function registerCanvasIpc(): void {
  typedHandle('canvas:get-snapshot', async (args) => {
    const content = await readFile(args.canvasPath, 'utf-8')
    const file: CanvasFile = JSON.parse(content)
    const stats = await stat(args.canvasPath)
    return { file, mtime: stats.mtime.toISOString() }
  })

  typedHandle('canvas:apply-plan', async (args) => {
    // Optimistic lock: check mtime
    const stats = await stat(args.canvasPath)
    const currentMtime = stats.mtime.toISOString()
    if (currentMtime !== args.expectedMtime) {
      return {
        error: 'stale' as const,
        message: `Canvas modified since snapshot (expected ${args.expectedMtime}, got ${currentMtime})`
      }
    }

    // Validate all ops
    const content = await readFile(args.canvasPath, 'utf-8')
    const file = JSON.parse(content) as Partial<CanvasFile>
    const existingNodes = Array.isArray(file.nodes) ? file.nodes : []
    const error = validateCanvasMutationOps(args.plan.ops, existingNodes)
    if (error) {
      return { error: 'validation-failed' as const, message: error }
    }

    // Dispatch validated plan to renderer for store application
    const window = getMainWindow()
    if (window) {
      typedSend(window, 'canvas:agent-plan-accepted', { plan: args.plan })
    }

    return { accepted: true, mtime: currentMtime }
  })
}
