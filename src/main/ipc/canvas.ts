import { typedHandle, typedSend } from '../typed-ipc'
import { getMainWindow } from '../window-registry'
import { readFile, readdir, stat, writeFile } from 'fs/promises'
import { TE_DIR } from '@shared/constants'
import type { CanvasFile } from '@shared/canvas-types'
import { validateCanvasMutationOps } from '@shared/canvas-mutation-validation'
import { enqueueCanvasWrite } from '../services/canvas-write-queue'

const DEFAULT_CANVAS_ID = 'default'

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
      typedSend(window, 'canvas:agent-plan-accepted', {
        plan: args.plan,
        canvasPath: args.canvasPath
      })
    }

    return { accepted: true, mtime: currentMtime }
  })

  typedHandle('canvas:save', async (args) => {
    await enqueueCanvasWrite(args.canvasPath, async () => {
      await writeFile(args.canvasPath, args.content, 'utf-8')
    })
  })

  typedHandle('canvas:list', async (args) => {
    const ids = new Set<string>([DEFAULT_CANVAS_ID])
    const namedDir = `${args.vaultPath}/${TE_DIR}/canvas`
    try {
      const entries = await readdir(namedDir)
      for (const name of entries) {
        if (!name.endsWith('.json')) continue
        const id = name.slice(0, -'.json'.length)
        if (id) ids.add(id)
      }
    } catch {
      // Directory doesn't exist yet — only the default canvas exists. Non-fatal.
    }
    // Default first, then named canvases sorted alphabetically.
    const named = [...ids].filter((id) => id !== DEFAULT_CANVAS_ID).sort()
    return { canvasIds: [DEFAULT_CANVAS_ID, ...named] }
  })
}
