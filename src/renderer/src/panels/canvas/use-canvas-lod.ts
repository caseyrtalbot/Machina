export type LodLevel = 'full' | 'preview' | 'dot'

const LOD_FULL_THRESHOLD = 0.3
const LOD_FULL_THRESHOLD_HEAVY = 0.3
const LOD_PREVIEW_THRESHOLD = 0.15

/**
 * Determines the level of detail for card rendering based on zoom.
 * Heavy card types (note, markdown) use a higher threshold to avoid
 * mounting Tiptap editors at overview zoom levels.
 */
export function getLodLevel(zoom: number, nodeType?: string): LodLevel {
  const threshold =
    nodeType === 'note' || nodeType === 'markdown' ? LOD_FULL_THRESHOLD_HEAVY : LOD_FULL_THRESHOLD
  if (zoom >= threshold) return 'full'
  if (zoom >= LOD_PREVIEW_THRESHOLD) return 'preview'
  return 'dot'
}
