import type { CanvasFile } from '@shared/canvas-types'
import { createCanvasFile } from '@shared/canvas-types'

export function serializeCanvas(file: CanvasFile): string {
  return JSON.stringify(file, null, 2)
}

export function deserializeCanvas(json: string): CanvasFile {
  try {
    const parsed = JSON.parse(json)
    return {
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
          : {}
    }
  } catch {
    return createCanvasFile()
  }
}

export function defaultCanvasFilename(existingNames: readonly string[]): string {
  const nameSet = new Set(existingNames)
  if (!nameSet.has('Untitled.canvas')) return 'Untitled.canvas'

  let i = 1
  while (nameSet.has(`Untitled ${i}.canvas`)) i++
  return `Untitled ${i}.canvas`
}

/** Save canvas file to disk via IPC. Debounce externally. */
export async function saveCanvas(path: string, file: CanvasFile): Promise<void> {
  await window.api.fs.writeFile(path, serializeCanvas(file))
}

/** Load canvas file from disk via IPC. */
export async function loadCanvas(path: string): Promise<CanvasFile> {
  try {
    const content = await window.api.fs.readFile(path)
    return deserializeCanvas(content)
  } catch {
    return createCanvasFile()
  }
}
