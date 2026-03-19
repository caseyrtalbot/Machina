import type { LodLevel } from './graph-types'

const MACRO_THRESHOLD = 0.35
const MICRO_THRESHOLD = 1.2
const MESO_LABEL_MIN_CONNECTIONS = 5

/** Determine LOD tier from current zoom scale. */
export function getGraphLod(scale: number): LodLevel {
  if (scale < MACRO_THRESHOLD) return 'macro'
  if (scale >= MICRO_THRESHOLD) return 'micro'
  return 'meso'
}

/** Whether to show a label for this node at the current LOD. */
export function shouldShowLabel(lod: LodLevel, connectionCount: number): boolean {
  if (lod === 'macro') return false
  if (lod === 'micro') return true
  return connectionCount >= MESO_LABEL_MIN_CONNECTIONS
}

/** Base node radius scaled by connection count. Min 4, max 24. */
export function nodeRadius(connectionCount: number): number {
  const base = 5
  const scaled = base + Math.sqrt(connectionCount) * 2.5
  return Math.min(Math.max(scaled, 4), 24)
}

/** Edge line width scaled by zoom (thinner when zoomed out). */
export function edgeWidth(scale: number): number {
  const base = 1.2
  return Math.max(0.5, base * Math.sqrt(Math.max(scale, 0.1)))
}
