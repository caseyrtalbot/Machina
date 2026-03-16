export type LodLevel = 'full' | 'preview' | 'dot'

const LOD_FULL_THRESHOLD = 0.3
const LOD_PREVIEW_THRESHOLD = 0.15

/**
 * Determines the level of detail for card rendering based on zoom.
 *
 * - full (zoom >= 0.3): Render the complete card with all interactive content
 * - preview (0.15 <= zoom < 0.3): Colored rectangle with title text
 * - dot (zoom < 0.15): Small colored dot, like graph nodes
 */
export function getLodLevel(zoom: number): LodLevel {
  if (zoom >= LOD_FULL_THRESHOLD) return 'full'
  if (zoom >= LOD_PREVIEW_THRESHOLD) return 'preview'
  return 'dot'
}
