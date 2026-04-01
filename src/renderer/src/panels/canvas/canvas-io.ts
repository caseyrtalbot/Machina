import type { CanvasFile } from '@shared/canvas-types'
import { createCanvasFile } from '@shared/canvas-types'

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

export function deserializeCanvas(json: string): CanvasFile {
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
    return result
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
