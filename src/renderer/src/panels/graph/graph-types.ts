import type { ArtifactType, RelationshipKind, Signal } from '@shared/types'

/** A simulation node with physics position and velocity. */
export interface SimNode {
  readonly index: number
  readonly id: string
  readonly title: string
  readonly type: ArtifactType
  readonly signal: Signal
  readonly connectionCount: number
  readonly origin?: 'human' | 'source' | 'agent'
  readonly isGhost: boolean
}

/** Messages from main thread → physics worker */
export type PhysicsCommand =
  | {
      type: 'init'
      nodes: SimNode[]
      edges: ReadonlyArray<{ source: number; target: number; kind: RelationshipKind }>
    }
  | { type: 'tick' }
  | { type: 'drag'; nodeIndex: number; x: number; y: number }
  | { type: 'drag-end'; nodeIndex: number }
  | { type: 'pin'; nodeIndex: number; x: number; y: number }
  | { type: 'unpin'; nodeIndex: number }
  | { type: 'reheat'; alpha?: number }
  | { type: 'stop' }
  | { type: 'resume' }
  | { type: 'update-params'; params: Partial<ForceParams> }

/** Messages from physics worker → main thread */
export type PhysicsResult =
  | { type: 'positions'; buffer: Float32Array; alpha: number; settled: boolean }
  | { type: 'ready' }
  | { type: 'error'; message: string }

/** Tunable force parameters (graph-layout defaults) */
export interface ForceParams {
  readonly centerStrength: number // 0.48 — gravity toward center
  readonly repelStrength: number // -250 — many-body repulsion (negative = repel)
  readonly linkStrength: number // 0.4 — spring stiffness
  readonly linkDistance: number // 180 — target edge length in px
  readonly velocityDecay: number // 0.4 — atmospheric friction
  readonly alphaDecay: number // 0.02 — cooling rate
  readonly alphaMin: number // 0.001 — convergence threshold
}

export const DEFAULT_FORCE_PARAMS: ForceParams = {
  centerStrength: 0.48,
  repelStrength: -250,
  linkStrength: 0.4,
  linkDistance: 180,
  velocityDecay: 0.4,
  alphaDecay: 0.02,
  alphaMin: 0.001
}

/** LOD tiers for zoom-based rendering */
export type LodLevel = 'micro' | 'meso' | 'macro'

/** Graph viewport state */
export interface GraphViewport {
  readonly x: number
  readonly y: number
  readonly scale: number
}
