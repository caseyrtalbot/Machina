import fs from 'node:fs/promises'
import { applyPlanOps, type CanvasMutationPlan } from '@shared/canvas-mutation-types'
import { validateCanvasMutationOps } from '@shared/canvas-mutation-validation'
import type { CanvasEdge, CanvasNode } from '@shared/canvas-types'
import { enqueueCanvasWrite } from './canvas-write-queue'

// Shared main-side canvas applier: the ONE place a CanvasMutationPlan is
// persisted to a canvas file on disk. Both lanes converge here — the native
// lane (pin_to_canvas / unpin_from_canvas, which build add-node / remove-node
// plans) and the MCP lane (canvas.apply_plan). Validation, the read-modify-write
// (via the pure applyPlanOps kernel), and the per-file write serialization all
// live in exactly one place, so canvas node/edge mutation is never hand-rolled
// twice. Held by tests/main/tool-surface.test.ts.

interface CanvasFileShape {
  nodes?: readonly unknown[]
  edges?: readonly unknown[]
  viewport?: unknown
  [k: string]: unknown
}

export type CanvasApplyResult =
  | { readonly ok: true; readonly mtime: string }
  | {
      readonly ok: false
      readonly error: 'not-found' | 'stale' | 'validation' | 'io'
      readonly message: string
      /** On a `stale` reject, the on-disk mtime that failed the precondition. */
      readonly currentMtime?: string
    }

export interface CanvasApplyOptions {
  /** Optimistic lock. When set, the stat + write happen inside the SAME queue
   * slot, so the mtime check and the write can't be split by a racing writer
   * (closes the check-then-write TOCTOU the MCP lane had when it stat'd outside
   * the serialization queue). Mismatch rejects with `stale`. */
  readonly expectedMtime?: string
}

/**
 * Apply a plan's node/edge ops to a canvas file. Serialized per-file, validated
 * against the file's current nodes, then persisted pretty-printed. Non-node/edge
 * top-level keys (viewport, version, ontology*) are preserved.
 */
export async function applyCanvasPlanToFile(
  file: string,
  plan: CanvasMutationPlan,
  opts: CanvasApplyOptions = {}
): Promise<CanvasApplyResult> {
  return enqueueCanvasWrite(file, async () => {
    let mtime: string
    try {
      mtime = (await fs.stat(file)).mtime.toISOString()
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e.code === 'ENOENT') return { ok: false, error: 'not-found', message: file }
      return { ok: false, error: 'io', message: e.message ?? String(err) }
    }
    if (opts.expectedMtime !== undefined && mtime !== opts.expectedMtime) {
      return {
        ok: false,
        error: 'stale',
        message: `Stale: canvas modified since snapshot (expected ${opts.expectedMtime}, got ${mtime})`,
        currentMtime: mtime
      }
    }

    let parsed: CanvasFileShape
    try {
      parsed = JSON.parse(await fs.readFile(file, 'utf8')) as CanvasFileShape
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e.code === 'ENOENT') return { ok: false, error: 'not-found', message: file }
      return { ok: false, error: 'io', message: e.message ?? String(err) }
    }

    const nodes = (Array.isArray(parsed.nodes) ? parsed.nodes : []) as CanvasNode[]
    const edges = (Array.isArray(parsed.edges) ? parsed.edges : []) as CanvasEdge[]

    const validationError = validateCanvasMutationOps(plan.ops, nodes)
    if (validationError) return { ok: false, error: 'validation', message: validationError }

    const applied = applyPlanOps(nodes, edges, plan.ops)
    const next: CanvasFileShape = { ...parsed, nodes: applied.nodes, edges: applied.edges }
    try {
      await fs.writeFile(file, JSON.stringify(next, null, 2), 'utf8')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: 'io', message }
    }
    return { ok: true, mtime }
  })
}

export type CanvasViewportWriteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: 'not-found' | 'io'; readonly message: string }

/**
 * Persist a canvas viewport (focus_canvas). Viewport is not part of the mutation
 * op vocabulary (no viewport op exists, by design), so it does not go through
 * applyPlanOps — but its file write shares this module so ALL canvas file writes
 * live in one place and are serialized on the same per-file queue.
 */
export async function writeCanvasViewport(
  file: string,
  viewport: { x: number; y: number; zoom: number }
): Promise<CanvasViewportWriteResult> {
  return enqueueCanvasWrite(file, async () => {
    let parsed: CanvasFileShape
    try {
      parsed = JSON.parse(await fs.readFile(file, 'utf8')) as CanvasFileShape
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e.code === 'ENOENT') return { ok: false, error: 'not-found', message: file }
      return { ok: false, error: 'io', message: e.message ?? String(err) }
    }
    const next: CanvasFileShape = { ...parsed, viewport }
    try {
      await fs.writeFile(file, JSON.stringify(next, null, 2), 'utf8')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: 'io', message }
    }
    return { ok: true }
  })
}
