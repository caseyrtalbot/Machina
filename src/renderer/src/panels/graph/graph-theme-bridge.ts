import { getArtifactColor, EDGE_KIND_COLORS } from '@renderer/design/tokens'
import type { ArtifactType, RelationshipKind } from '@shared/types'

/** Convert a hex color string to a PixiJS-compatible integer. */
export function hexToPixi(hex: string): number {
  let h = hex.replace('#', '')
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  }
  return parseInt(h, 16)
}

/** Get the PixiJS tint color for an artifact type. */
export function nodeColorForType(type: ArtifactType): number {
  return hexToPixi(getArtifactColor(type))
}

// Default fallback for edge kinds not in EDGE_KIND_COLORS
const FALLBACK_EDGE_COLOR = hexToPixi(EDGE_KIND_COLORS.connection)

/** Get the PixiJS color for an edge based on its relationship kind. */
export function buildEdgeColor(kind: RelationshipKind): number {
  const hex = EDGE_KIND_COLORS[kind]
  return hex ? hexToPixi(hex) : FALLBACK_EDGE_COLOR
}

/** Edge opacity by kind (explicit relationships more visible than inferred). */
export function edgeOpacity(kind: RelationshipKind): number {
  switch (kind) {
    case 'connection':
    case 'cluster':
    case 'tension':
      return 0.85
    case 'appears_in':
      return 0.75
    case 'related':
      return 0.8
    case 'co-occurrence':
      return 0.6
  }
}
