/**
 * Project-map Web Worker: receives file chunks, analyzes them,
 * computes tree layout, returns positioned canvas nodes + edges.
 *
 * Follows the vault-worker pattern of union-typed messages.
 * Exports processWorkerMessage + resetWorkerState for testability.
 */

import type { CanvasNode, CanvasEdge } from '@shared/canvas-types'
import type { ProjectMapOptions } from '@shared/engine/project-map-types'
import type { FileInput } from '@shared/engine/project-map-analyzers'
import { buildProjectMapSnapshot } from '@shared/engine/project-map-analyzers'
import { computeFolderMapLayout } from '../panels/canvas/folder-map-layout'

// ─── Message types ──────────────────────────────────────────────────

export type ProjectMapWorkerIn =
  | {
      type: 'start'
      operationId: string
      rootPath: string
      options: ProjectMapOptions
    }
  | {
      type: 'append-files'
      operationId: string
      files: Array<{ path: string; content: string | null; error?: string }>
    }
  | {
      type: 'finalize'
      operationId: string
      existingNodes: readonly CanvasNode[]
    }
  | { type: 'cancel'; operationId: string }

export type ProjectMapWorkerOut =
  | {
      type: 'progress'
      operationId: string
      phase: 'analyzing' | 'laying-out'
      filesProcessed: number
      totalFiles: number
    }
  | {
      type: 'result'
      operationId: string
      snapshot: ReturnType<typeof buildProjectMapSnapshot>
      nodes: CanvasNode[]
      edges: CanvasEdge[]
    }
  | { type: 'error'; operationId: string; message: string }

// ─── Worker state ──────────────────────────────────────────────────

let currentOperationId: string | null = null
let currentRootPath = ''
let currentOptions: ProjectMapOptions = { expandDepth: 2, maxNodes: 200 }
let accumulatedFiles: FileInput[] = []

export function resetWorkerState(): void {
  currentOperationId = null
  currentRootPath = ''
  currentOptions = { expandDepth: 2, maxNodes: 200 }
  accumulatedFiles = []
}

// ─── Message handler ────────────────────────────────────────────────

export function processWorkerMessage(msg: ProjectMapWorkerIn, post: (msg: unknown) => void): void {
  switch (msg.type) {
    case 'start': {
      currentOperationId = msg.operationId
      currentRootPath = msg.rootPath
      currentOptions = msg.options
      accumulatedFiles = []
      break
    }

    case 'append-files': {
      if (msg.operationId !== currentOperationId) return
      for (const file of msg.files) {
        accumulatedFiles.push(file)
      }
      post({
        type: 'progress',
        operationId: msg.operationId,
        phase: 'analyzing',
        filesProcessed: accumulatedFiles.length,
        totalFiles: accumulatedFiles.length
      })
      break
    }

    case 'finalize': {
      if (msg.operationId !== currentOperationId) return
      try {
        const snapshot = buildProjectMapSnapshot(currentRootPath, accumulatedFiles, currentOptions)
        const layout = computeFolderMapLayout(snapshot, { x: 0, y: 0 }, [...msg.existingNodes])
        post({
          type: 'result',
          operationId: msg.operationId,
          snapshot,
          nodes: layout.nodes,
          edges: layout.edges
        })
      } catch (err) {
        post({
          type: 'error',
          operationId: msg.operationId,
          message: err instanceof Error ? err.message : String(err)
        })
      }
      break
    }

    case 'cancel': {
      if (msg.operationId === currentOperationId) {
        resetWorkerState()
      }
      break
    }
  }
}

// ─── Wire up as Web Worker (only runs in worker context) ─────────────

if (
  typeof self !== 'undefined' &&
  typeof (self as { document?: unknown }).document === 'undefined'
) {
  self.onmessage = (e: MessageEvent<ProjectMapWorkerIn>) => {
    processWorkerMessage(e.data, (msg) => self.postMessage(msg))
  }
}
