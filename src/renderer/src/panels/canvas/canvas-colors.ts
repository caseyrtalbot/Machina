/**
 * Card-type colors for the zoomed-out canvas renderers (LOD rectangles + the
 * minimap). A single source so CardLodPreview and CanvasMinimap can't drift —
 * the minimap's private copy had silently lost `pdf` and `terminal-block`.
 * Unknown types fall back to the `text` slate.
 *
 * Deliberately NOT `getArtifactColor`: that hashes the type string into
 * CUSTOM_TYPE_PALETTE, which would assign these card types unrelated colors.
 */
const CARD_TYPE_COLORS: Record<string, string> = {
  text: '#94a3b8',
  code: '#22d3ee',
  markdown: '#a78bfa',
  note: '#38bdf8',
  image: '#f472b6',
  terminal: '#34d399',
  pdf: '#ef4444',
  'terminal-block': '#10b981'
}

export function getCardTypeColor(type: string): string {
  return CARD_TYPE_COLORS[type] ?? CARD_TYPE_COLORS.text
}
