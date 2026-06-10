import type { CanvasFile } from '@shared/canvas-types'
import type { Result } from '@shared/engine/types'
import { notifyError } from '../../utils/error-logger'

export function serializeCanvas(file: CanvasFile): string {
  const output: Record<string, unknown> = {
    version: file.ontologySnapshot ? 2 : (file.version ?? 1),
    nodes: file.nodes,
    edges: file.edges,
    viewport: file.viewport,
    focusFrames: file.focusFrames
  }
  if (file.ontologySnapshot) {
    output.ontologySnapshot = file.ontologySnapshot
  }
  if (file.ontologyLayout) {
    output.ontologyLayout = file.ontologyLayout
  }
  return JSON.stringify(output, null, 2)
}

/** Parse a serialized canvas. Returns `{ ok: false }` on corrupt JSON instead of
 * silently substituting an empty canvas — callers decide how to surface it. */
export function deserializeCanvas(json: string): Result<CanvasFile> {
  try {
    const parsed = JSON.parse(json)
    const result: CanvasFile = {
      version: typeof parsed.version === 'number' ? parsed.version : 1,
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
      viewport: {
        x: typeof parsed.viewport?.x === 'number' ? parsed.viewport.x : 0,
        y: typeof parsed.viewport?.y === 'number' ? parsed.viewport.y : 0,
        zoom: typeof parsed.viewport?.zoom === 'number' ? parsed.viewport.zoom : 1
      },
      focusFrames:
        parsed.focusFrames &&
        typeof parsed.focusFrames === 'object' &&
        !Array.isArray(parsed.focusFrames)
          ? parsed.focusFrames
          : {},
      ...(parsed.ontologySnapshot ? { ontologySnapshot: parsed.ontologySnapshot } : {}),
      ...(parsed.ontologyLayout ? { ontologyLayout: parsed.ontologyLayout } : {})
    }
    return { ok: true, value: result }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Load a canvas file from disk. On corrupt JSON: back the file up to `<path>.bak`,
 * surface the error to the user, and return null so the spatial arrangement is
 * never silently replaced with an empty canvas (and later autosaved over). */
export async function loadCanvasFromDisk(path: string): Promise<CanvasFile | null> {
  const raw = await window.api.fs.readFile(path)
  const parsed = deserializeCanvas(raw)
  if (parsed.ok) return parsed.value

  const bakPath = `${path}.bak`
  try {
    await window.api.fs.copyFile(path, bakPath)
    notifyError(
      'canvas-load',
      new Error(parsed.error),
      `Canvas file is corrupt — backed up to ${bakPath}. Restore it manually or remove canvas.json to start fresh.`
    )
  } catch (copyErr) {
    notifyError(
      'canvas-load',
      copyErr,
      `Canvas file is corrupt and the backup to ${bakPath} failed — ${path} left untouched.`
    )
  }
  return null
}

export function defaultCanvasFilename(existingNames: readonly string[]): string {
  const nameSet = new Set(existingNames)
  if (!nameSet.has('Untitled.canvas')) return 'Untitled.canvas'

  let i = 1
  while (nameSet.has(`Untitled ${i}.canvas`)) i++
  return `Untitled ${i}.canvas`
}

/** Save canvas file to disk via IPC. Debounce externally.
 * Routes through the canvas-specific channel so writes serialize against
 * agent-side mutations (pin_to_canvas, unpin_from_canvas, focus_canvas)
 * via the shared per-file mutex in main. Plain fs:write-file would bypass
 * that mutex and race with in-flight agent writes. */
export async function saveCanvas(path: string, file: CanvasFile): Promise<void> {
  await window.api.canvas.save(path, serializeCanvas(file))
}
