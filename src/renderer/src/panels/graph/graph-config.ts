import type { GraphNode, RelationshipKind } from '@shared/types'

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export interface SimNode extends GraphNode {
  x: number
  y: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
  /** Pre-resolved display color (set by panel from group rules). */
  _color?: string
  /** Whether this node has been visited/opened by the user. */
  _visited?: boolean
}

export interface SimEdge {
  source: string | SimNode
  target: string | SimNode
  kind: RelationshipKind
}

export interface SimulationConfig {
  centerForce: number
  repelForce: number
  linkForce: number
  linkDistance: number
  enableRadial?: boolean
}

// ---------------------------------------------------------------------------
// Highlight types
// ---------------------------------------------------------------------------

export type HighlightMode = 'idle' | 'hover' | 'click'

export interface HighlightState {
  mode: HighlightMode
  focusedNodeId: string | null
  connectedSet: ReadonlySet<string>
  glowIntensity: number
}

export interface RenderOptions {
  highlight: HighlightState
  transform: { x: number; y: number; k: number }
  canvasWidth: number
  canvasHeight: number
  nodeSizeMultiplier: number
  linkThickness: number
  textFadeThreshold: number
  showArrows: boolean
  searchQuery: string
  glowIntensity?: number
  getNodeTransition?: (nodeId: string, now: number) => { opacity: number; scale: number }
}

// ---------------------------------------------------------------------------
// Deep Space palette — graph-specific colors independent of app theme
// ---------------------------------------------------------------------------

export const GRAPH_PALETTE = {
  canvasBg: '#0a0a12',
  defaultNote: '#8a8a9e',
  visitedNote: '#b8a9c9',
  defaultTag: '#e6a237',
  defaultAttach: '#6b7280',
  linkDefault: 'rgba(255, 255, 255, 0.04)',
  linkActive: '#2dd4bf',
  linkDimmed: 'rgba(255, 255, 255, 0)',
  labelColor: 'rgba(255, 255, 255, 0.7)',
  selectedRing: '#2dd4bf',
  tagStroke: '#e6a237',
  vignetteEdge: 'rgba(0, 0, 0, 0.4)'
} as const

// ---------------------------------------------------------------------------
// Physics constants
// ---------------------------------------------------------------------------

export const LINK_STRENGTH: Record<RelationshipKind, number> = {
  connection: 0.3,
  cluster: 0.6,
  tension: -0.2,
  appears_in: 0.2,
  wikilink: 0.15,
  tag: 0.1
}

export const LARGE_GRAPH_THRESHOLD = 200

export const DEFAULT_SIM_CONFIG: SimulationConfig = {
  centerForce: 0.02,
  repelForce: -120,
  linkForce: 0.7,
  linkDistance: 50
}

// ---------------------------------------------------------------------------
// Render constants
// ---------------------------------------------------------------------------

export const CULL_MARGIN = 40
export const LABEL_OFFSET_BELOW = 10
export const ARROW_SIZE = 6

// Bokeh constants
export const BOKEH_RADIUS_SCALE = 1.5
export const BOKEH_FILL_ALPHA = 0.08
export const BOKEH_SHADOW_BLUR = 8

// Glow constants
export const NEIGHBOR_SHADOW_BLUR = 6
export const FOCAL_SHADOW_BLUR = 16
