import type { BuiltInArtifactType } from '@shared/types'

export const colors = {
  bg: {
    base: 'var(--color-bg-base)',
    surface: 'var(--color-bg-surface)',
    elevated: 'var(--color-bg-elevated)'
  },
  border: {
    default: 'var(--color-border-default)',
    subtle: 'var(--border-subtle)'
  },
  text: {
    primary: 'var(--color-text-primary)',
    secondary: 'var(--color-text-secondary)',
    muted: 'var(--color-text-muted)'
  },
  accent: {
    default: 'var(--color-accent-default)',
    hover: 'var(--color-accent-hover)',
    muted: 'var(--color-accent-muted)'
  },
  semantic: {
    cluster: '#3dca8d',
    tension: '#ecaa0b'
  }
} as const

/* ── OKLCH Perceptually Uniform Palette ──────────────────────────────────
 * All artifact types use L=0.75, C=0.15 (varying only hue) for equal
 * visual weight regardless of color. Exception: note uses C=0.03
 * (desaturated) since it's the most common type and should recede.
 *
 * Edge kinds use deliberately lower L/C so edges don't compete with nodes.
 *
 * Hex values computed via scripts/oklch-to-hex.mjs with sRGB gamut clamping.
 * To regenerate: node scripts/oklch-to-hex.mjs
 */
export const ARTIFACT_COLORS = {
  gene: '#00cca8', // oklch(0.75 0.15 175) teal
  constraint: '#ff847d', // oklch(0.75 0.15 25) red
  research: '#ad9cff', // oklch(0.75 0.15 290) purple
  output: '#ec86cc', // oklch(0.75 0.15 340) pink
  note: '#a3afc1', // oklch(0.75 0.03 260) slate (low chroma)
  index: '#00befa', // oklch(0.75 0.15 230) sky
  session: '#4ec983', // oklch(0.75 0.15 155) emerald
  pattern: '#dfa11a', // oklch(0.75 0.15 80) amber
  tension: '#fe838f' // oklch(0.75 0.15 15) rose
} as const satisfies Record<BuiltInArtifactType, string>

// Custom type palette: 9 OKLCH hues at L=0.75, C=0.15, evenly spaced
const CUSTOM_TYPE_PALETTE = [
  '#fa8c58', // oklch(0.75 0.15 45) orange
  '#c4af1c', // oklch(0.75 0.15 100) gold
  '#83c35d', // oklch(0.75 0.15 135) lime
  '#00cacb', // oklch(0.75 0.15 195) cyan
  '#00c4e9', // oklch(0.75 0.15 215) sky-teal
  '#5cb3ff', // oklch(0.75 0.15 250) blue
  '#93a4ff', // oklch(0.75 0.15 275) indigo
  '#cb91f4', // oklch(0.75 0.15 310) violet
  '#f683b3' // oklch(0.75 0.15 355) magenta
] as const

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

export function getArtifactColor(type: string): string {
  if (type === 'tag') return '#dfa11a'
  const builtIn = (ARTIFACT_COLORS as Record<string, string>)[type]
  if (builtIn) return builtIn
  return CUSTOM_TYPE_PALETTE[hashString(type) % CUSTOM_TYPE_PALETTE.length]
}

export const ontologyColors = {
  'ontology-green': '#8fbe8f', // oklch(0.75 0.15 145)
  'ontology-blue': '#7bacd4', // oklch(0.75 0.15 230)
  'ontology-orange': '#d4a67b', // oklch(0.75 0.15 30)
  'ontology-purple': '#c78fbe', // oklch(0.75 0.15 320)
  'ontology-yellow': '#beb87b', // oklch(0.75 0.15 80)
  'ontology-red': '#d48f8f', // oklch(0.75 0.15 0)
  'ontology-teal': '#7bc4be', // oklch(0.75 0.15 185)
  'ontology-indigo': '#9b8fd4' // oklch(0.75 0.15 280)
} as const

export const spacing = {
  unit: 4,
  panelGap: 0,
  contentPadX: 32,
  contentPadY: 24,
  sidebarWidth: 260,
  terminalMinWidth: 320
} as const

export const typography = {
  fontFamily: {
    display: 'var(--font-display, system-ui, sans-serif)',
    body: 'var(--font-body, system-ui, sans-serif)',
    mono: 'var(--font-mono, "JetBrains Mono", monospace)'
  },
  metadata: {
    size: '11px',
    letterSpacing: '0.05em',
    textTransform: 'uppercase' as const
  }
} as const

export const transitions = {
  default: '150ms ease-out',
  hover: '150ms ease-out',
  tooltip: '100ms ease-in',
  focusRing: '100ms ease-out',
  settingsSlide: '250ms ease-out',
  modalFade: '200ms ease-in',
  commandPalette: '150ms ease-out'
} as const

export const borderRadius = { container: 6, inline: 4, card: 0, round: '50%' } as const

export const EDGE_KIND_COLORS: Record<string, string> = {
  connection: '#667383', // oklch(0.55 0.03 255) neutral slate
  cluster: '#3dca8d', // oklch(0.75 0.15 160) green
  tension: '#ecaa0b', // oklch(0.78 0.16 80) amber
  related: '#9887e8', // oklch(0.68 0.14 290) purple
  'co-occurrence': '#4e5661', // oklch(0.45 0.02 255) dark slate
  appears_in: '#667383', // oklch(0.55 0.03 255) neutral
  causal: '#da76bb', // oklch(0.70 0.15 340) pink
  contains: '#4e5661', // oklch(0.45 0.02 255) subtle structural gray
  imports: '#5b8dd9', // oklch(0.65 0.12 260) muted blue
  references: '#9887e8' // oklch(0.68 0.14 290) muted purple
} as const

export const canvasTokens = {
  surface: 'var(--canvas-surface-bg)',
  card: 'var(--canvas-card-bg)',
  cardTitleBar: 'var(--canvas-card-title-bg)',
  cardBorder: 'var(--canvas-card-border)',
  textHeading: 'var(--canvas-text-heading)',
  blockquoteBar: 'var(--canvas-blockquote-bar)',
  cardRadius: 6,
  contentPadding: 24,
  badgeGreen: '#4caf50',
  linkCyan: '#5cb8c4',
  ontology: {
    sectionFillOpacity: 0.06,
    sectionStrokeOpacity: 0.25,
    sectionBorderRadius: 14,
    headerFillOpacity: 0.1,
    childFillOpacity: 0.04,
    childStrokeOpacity: 0.15,
    connectionOpacity: 0.15,
    headerDotRadius: 5
  }
} as const

export const floatingPanel = {
  borderRadius: 12,
  shadow: '0 8px 32px rgba(0,0,0,0.4), 0 2px 8px rgba(0,0,0,0.3)',
  shadowCompact: '0 4px 16px rgba(0,0,0,0.3), 0 1px 4px rgba(0,0,0,0.2)',
  glass: {
    bg: 'rgba(8, 8, 12, 0.88)',
    blur: 'blur(24px) saturate(1.3)',
    inputBg: 'rgba(255, 255, 255, 0.04)',
    inputBgFocus: 'rgba(255, 255, 255, 0.07)',
    popoverBg: 'rgba(8, 8, 12, 0.95)',
    popoverBlur: 'blur(16px) saturate(1.2)',
    sectionLabel: {
      fontSize: '10px',
      fontWeight: '600',
      textTransform: 'uppercase' as const,
      letterSpacing: '0.15em'
    }
  }
} as const
