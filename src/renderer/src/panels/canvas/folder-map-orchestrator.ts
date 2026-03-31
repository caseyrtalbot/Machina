/**
 * Orchestrates folder-to-canvas mapping: chunked IPC reads, worker coordination,
 * progress tracking, and cancellation. In Phase 1D, applies directly to canvas.
 * Preview/apply flow added in Slice 2.
 */

import type { CanvasNode, CanvasEdge } from '@shared/canvas-types'
import type { ProjectMapOptions, ProjectMapSnapshot } from '@shared/engine/project-map-types'
import { DEFAULT_PROJECT_MAP_OPTIONS, isBinaryPath } from '@shared/engine/project-map-types'
import type { ProjectMapWorkerIn, ProjectMapWorkerOut } from '../../workers/project-map-worker'

const CHUNK_SIZE = 50

// ─── Progress state ──────────────────────────────────────────────────

export interface FolderMapProgress {
  readonly phase:
    | 'idle'
    | 'listing'
    | 'reading'
    | 'analyzing'
    | 'laying-out'
    | 'done'
    | 'error'
    | 'cancelled'
  readonly filesProcessed: number
  readonly totalFiles: number
  readonly errorMessage?: string
}

export type ProgressCallback = (progress: FolderMapProgress) => void

// ─── Orchestrator result ─────────────────────────────────────────────

export interface FolderMapResult {
  readonly snapshot: ProjectMapSnapshot
  readonly nodes: readonly CanvasNode[]
  readonly edges: readonly CanvasEdge[]
}

// ─── Main orchestration function ─────────────────────────────────────

let currentOperationId: string | null = null

function generateOperationId(): string {
  return `fmo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Cancel any in-flight folder map operation.
 */
export function cancelFolderMap(): void {
  currentOperationId = null
}

/**
 * Map a folder to canvas nodes + edges.
 * Returns the result or null if cancelled.
 */
export async function mapFolderToCanvas(
  rootPath: string,
  existingNodes: readonly CanvasNode[],
  onProgress: ProgressCallback,
  options: Partial<ProjectMapOptions> = {}
): Promise<FolderMapResult | null> {
  const opts = { ...DEFAULT_PROJECT_MAP_OPTIONS, ...options }
  const operationId = generateOperationId()
  currentOperationId = operationId

  const isCancelled = () => currentOperationId !== operationId

  try {
    // 1. List files
    onProgress({ phase: 'listing', filesProcessed: 0, totalFiles: 0 })
    const allFiles = await window.api.fs.listAllFiles(rootPath)
    if (isCancelled()) return null

    const skippedFiles = allFiles
      .filter((f) => isBinaryPath(f.path))
      .map((f) => ({ path: f.path, content: null, error: 'binary-skipped' }))
    const readableFiles = allFiles.filter((f) => !isBinaryPath(f.path))
    const totalFiles = allFiles.length

    // 2. Create worker
    const worker = new Worker(new URL('../../workers/project-map-worker.ts', import.meta.url), {
      type: 'module'
    })

    return await new Promise<FolderMapResult | null>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<ProjectMapWorkerOut>) => {
        if (isCancelled()) {
          worker.terminate()
          resolve(null)
          return
        }

        const msg = e.data
        switch (msg.type) {
          case 'progress':
            onProgress({
              phase: msg.phase,
              filesProcessed: msg.filesProcessed,
              totalFiles
            })
            break
          case 'result':
            onProgress({ phase: 'done', filesProcessed: totalFiles, totalFiles })
            worker.terminate()
            resolve({
              snapshot: msg.snapshot,
              nodes: msg.nodes as readonly CanvasNode[],
              edges: msg.edges as readonly CanvasEdge[]
            })
            break
          case 'error':
            onProgress({
              phase: 'error',
              filesProcessed: 0,
              totalFiles,
              errorMessage: msg.message
            })
            worker.terminate()
            reject(new Error(msg.message))
            break
        }
      }

      worker.onerror = (err) => {
        onProgress({
          phase: 'error',
          filesProcessed: 0,
          totalFiles,
          errorMessage: err.message
        })
        worker.terminate()
        reject(new Error(err.message))
      }

      // Start the worker
      const startMsg: ProjectMapWorkerIn = {
        type: 'start',
        operationId,
        rootPath,
        options: opts
      }
      worker.postMessage(startMsg)

      if (skippedFiles.length > 0) {
        worker.postMessage({
          type: 'append-files',
          operationId,
          files: skippedFiles
        } satisfies ProjectMapWorkerIn)
      }

      // Read files in chunks
      void (async () => {
        try {
          for (let i = 0; i < readableFiles.length; i += CHUNK_SIZE) {
            if (isCancelled()) {
              worker.postMessage({ type: 'cancel', operationId })
              worker.terminate()
              resolve(null)
              return
            }

            const chunk = readableFiles.slice(i, i + CHUNK_SIZE)
            onProgress({ phase: 'reading', filesProcessed: skippedFiles.length + i, totalFiles })

            const results = await window.api.fs.readFilesBatch(chunk.map((f) => f.path))
            if (isCancelled()) {
              worker.terminate()
              resolve(null)
              return
            }

            worker.postMessage({
              type: 'append-files',
              operationId,
              files: results
            } satisfies ProjectMapWorkerIn)
          }

          // Finalize
          onProgress({ phase: 'laying-out', filesProcessed: totalFiles, totalFiles })
          worker.postMessage({
            type: 'finalize',
            operationId,
            existingNodes: [...existingNodes]
          } satisfies ProjectMapWorkerIn)
        } catch (err) {
          worker.terminate()
          reject(err)
        }
      })()
    })
  } catch (err) {
    if (!isCancelled()) {
      onProgress({
        phase: 'error',
        filesProcessed: 0,
        totalFiles: 0,
        errorMessage: err instanceof Error ? err.message : String(err)
      })
    }
    throw err
  }
}
