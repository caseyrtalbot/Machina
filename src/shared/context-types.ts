import type { CanvasNodeType } from '@shared/canvas-types'

/** All edge kinds across both canvas and knowledge graph systems. */
export type ContextEdgeKind =
  | 'causal'
  | 'tension'
  | 'connection'
  | 'cluster'
  | 'related'
  | 'appears_in'
  | 'co-occurrence'

/** Edge types ranked by causal strength (highest first).
 *  Research: CGMT paper shows causal-first retrieval gives 10% accuracy gains. */
export const EDGE_PRIORITY: readonly ContextEdgeKind[] = [
  'causal',
  'tension',
  'connection',
  'cluster',
  'related',
  'appears_in',
  'co-occurrence'
] as const

/** Summary for cards connected by edges. Incident encoding format. */
export interface ConnectedCard {
  readonly id: string
  readonly type: CanvasNodeType
  readonly title: string
  readonly edgeKind: ContextEdgeKind
  readonly edgeLabel?: string
  readonly contentSnippet: string
}

/** Serialization options controlling budget and behavior. */
export interface ContextOptions {
  readonly maxTokens?: number // default 500
  readonly edgePriorityOverride?: readonly ContextEdgeKind[]
  /** Path to the context file that auto-notify updates on canvas changes.
   *  Included in the system prompt so Claude knows where to read updates. */
  readonly contextFilePath?: string
}
