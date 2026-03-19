import { getArtifactColor } from '@renderer/design/tokens'
import type { ArtifactType, RelationshipKind } from '@shared/types'

/** Convert a hex color string to a PixiJS-compatible integer. */
export function hexToPixi(hex: string): number {
  let h = hex.replace('#', '')
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  }
  return parseInt(h, 16)
}

/** Convert CSS color string (hex or rgb()) to PixiJS integer. */
export function cssColorToPixi(css: string): number {
  if (css.startsWith('#')) return hexToPixi(css)
  const match = css.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (match) {
    return (parseInt(match[1]) << 16) | (parseInt(match[2]) << 8) | parseInt(match[3])
  }
  return 0x94a3b8 // fallback: slate
}

/** Get the PixiJS tint color for an artifact type. */
export function nodeColorForType(type: ArtifactType): number {
  return hexToPixi(getArtifactColor(type))
}

// Semantic relationship colors (from tokens.ts)
const CLUSTER_COLOR = 0x34d399
const TENSION_COLOR = 0xf59e0b
const DEFAULT_EDGE_COLOR = 0x64748b
const COOCCURRENCE_COLOR = 0x475569
const APPEARS_IN_COLOR = 0x64748b

/** Get the PixiJS color for an edge based on its relationship kind. */
export function buildEdgeColor(kind: RelationshipKind): number {
  switch (kind) {
    case 'cluster':
      return CLUSTER_COLOR
    case 'tension':
      return TENSION_COLOR
    case 'connection':
      return DEFAULT_EDGE_COLOR
    case 'appears_in':
      return APPEARS_IN_COLOR
    case 'co-occurrence':
      return COOCCURRENCE_COLOR
  }
}

/** Edge opacity by kind (explicit relationships more visible than inferred). */
export function edgeOpacity(kind: RelationshipKind): number {
  switch (kind) {
    case 'connection':
    case 'cluster':
    case 'tension':
      return 0.85
    case 'appears_in':
      return 0.65
    case 'co-occurrence':
      return 0.5
  }
}
