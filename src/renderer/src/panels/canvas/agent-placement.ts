// ---------------------------------------------------------------------------
// Agent card placement — pure function, no side effects
// ---------------------------------------------------------------------------

import type { CanvasNode } from '@shared/canvas-types'

export interface PlacementViewport {
  readonly x: number
  readonly y: number
  readonly zoom: number
  readonly width: number
  readonly height: number
}

/** Gap between placed cards, matches existing canvas conventions. */
export const PLACEMENT_GAP = 40

/**
 * AABB overlap check: do two axis-aligned rectangles overlap?
 * Touching edges (exactly adjacent) are NOT considered overlapping.
 */
export function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

/**
 * Compute where to place a new agent card on the canvas.
 * Places at viewport center.
 */
export function computeAgentPlacement(
  _nodes: readonly CanvasNode[],
  viewport: PlacementViewport
): { x: number; y: number } {
  return {
    x: viewport.x + viewport.width / (2 * viewport.zoom),
    y: viewport.y + viewport.height / (2 * viewport.zoom)
  }
}
