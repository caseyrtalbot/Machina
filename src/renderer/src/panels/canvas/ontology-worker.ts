/**
 * Ontology Web Worker: computes grouping + layout off the main thread.
 *
 * Receives canvas cards, vault artifacts, and graph edges; returns an
 * OntologySnapshot (semantic grouping) + OntologyLayoutResult (positions).
 *
 * Follows the project-map-worker pattern of union-typed messages with
 * a guard that only wires up self.onmessage in worker context.
 */

import { computeOntologySnapshot } from '@shared/engine/ontology-grouping'
import { computeOntologyLayout } from '@shared/engine/ontology-layout'
import type { OntologySnapshot, OntologyLayoutResult } from '@shared/engine/ontology-types'

// ─── Message types ──────────────────────────────────────────────────

export interface OntologyWorkerRequest {
  readonly type: 'compute'
  readonly cards: readonly {
    readonly id: string
    readonly type: string
    readonly content: string
  }[]
  readonly fileToId: Readonly<Record<string, string>>
  readonly artifacts: Readonly<
    Record<
      string,
      {
        readonly id: string
        readonly tags: readonly string[]
        readonly bodyLinks: readonly string[]
        readonly connections: readonly string[]
        readonly concepts: readonly string[]
        readonly title: string
      }
    >
  >
  readonly graphEdges: readonly {
    readonly source: string
    readonly target: string
    readonly kind: string
  }[]
  readonly cardSizes: Readonly<Record<string, { width: number; height: number }>>
  readonly origin: { readonly x: number; readonly y: number }
}

export type OntologyWorkerResponse =
  | {
      readonly type: 'result'
      readonly snapshot: OntologySnapshot
      readonly layout: OntologyLayoutResult
    }
  | { readonly type: 'error'; readonly message: string }

// ─── Core logic (exported for testability) ──────────────────────────

export function processOntologyRequest(req: OntologyWorkerRequest): OntologyWorkerResponse {
  try {
    const snapshot = computeOntologySnapshot({
      cards: req.cards,
      fileToId: req.fileToId,
      artifacts: req.artifacts,
      graphEdges: req.graphEdges
    })

    const layout = computeOntologyLayout(snapshot, req.cardSizes, req.origin)

    return { type: 'result', snapshot, layout }
  } catch (err) {
    return {
      type: 'error',
      message: err instanceof Error ? err.message : 'Unknown error in ontology worker'
    }
  }
}

// ─── Wire up as Web Worker (only runs in worker context) ─────────────

if (
  typeof self !== 'undefined' &&
  typeof (self as { document?: unknown }).document === 'undefined'
) {
  self.onmessage = (event: MessageEvent<OntologyWorkerRequest>) => {
    const req = event.data
    if (req.type !== 'compute') return

    const response = processOntologyRequest(req)
    self.postMessage(response)
  }
}
