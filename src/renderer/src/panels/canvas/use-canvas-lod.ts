type LodLevel = 'full' | 'preview'

const LOD_FULL_THRESHOLD = 0.3

/**
 * Determines the level of detail for card rendering based on zoom.
 * Above the threshold, cards render their real content (editors, PTYs,
 * etc.); below it, they render as a cheap colored rectangle preview.
 */
export function getLodLevel(zoom: number): LodLevel {
  return zoom >= LOD_FULL_THRESHOLD ? 'full' : 'preview'
}
