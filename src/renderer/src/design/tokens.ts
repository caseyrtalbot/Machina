import type { BuiltInArtifactType } from '@shared/types'

export const colors = {
  bg: {
    base: 'var(--color-bg-base)',
    surface: 'var(--color-bg-surface)',
    elevated: 'var(--color-bg-elevated)',
    chrome: 'var(--color-bg-chrome)',
    rail: 'var(--color-bg-rail)'
  },
  border: {
    default: 'var(--color-border-default)',
    subtle: 'var(--border-subtle)',
    strong: 'var(--color-border-strong)'
  },
  text: {
    primary: 'var(--color-text-primary)',
    secondary: 'var(--color-text-secondary)',
    muted: 'var(--color-text-muted)',
    disabled: 'var(--color-text-disabled)'
  },
  accent: {
    default: 'var(--color-accent-default)',
    hover: 'var(--color-accent-hover)',
    muted: 'var(--color-accent-muted)',
    soft: 'var(--color-accent-soft)',
    line: 'var(--color-accent-line)'
  },
  semantic: {
    cluster: '#3dca8d',
    tension: '#ecaa0b'
  },
  claude: {
    ready: '#4ec983', // ARTIFACT_COLORS.session emerald
    warning: '#dfa11a', // ARTIFACT_COLORS.pattern amber
    error: '#ff847d' // ARTIFACT_COLORS.constraint red
  },
  // Diff line colors. Reuse the ready/error palette so + and - read the same
  // semantic green/red used elsewhere in the app. Background tints stay below
  // 12% mix so they sit comfortably inside an elevated tool-card surface.
  diff: {
    added: '#4ec983',
    removed: '#ff847d',
    addedBg: 'color-mix(in srgb, #4ec983 10%, transparent)',
    removedBg: 'color-mix(in srgb, #ff847d 10%, transparent)'
  },
  // Dock tab strip palette. Hover/active backgrounds are token-tinted off the
  // primary text so they pick up the user's accent through CSS vars instead of
  // a hardcoded gray. Active fg switches to primary; idle is secondary.
  tab: {
    bg: 'transparent',
    bgHover: 'color-mix(in srgb, var(--color-text-primary) 4%, transparent)',
    bgActive: 'var(--color-bg-elevated)',
    fg: 'var(--color-text-secondary)',
    fgActive: 'var(--color-text-primary)',
    border: 'var(--color-border-default)'
  },
  // Callout palette for `> [!TYPE]` blocks in the editor. Five semantic groups
  // plus a neutral muted group. Warning/danger reuse `colors.claude.*` so the
  // editor's callout accents stay consistent with other semantic surfaces.
  callout: {
    info: {
      bg: 'color-mix(in srgb, #38bdf8 8%, transparent)',
      border: '#38bdf8'
    },
    success: {
      bg: 'color-mix(in srgb, #34d399 8%, transparent)',
      border: '#34d399'
    },
    warning: {
      bg: 'color-mix(in srgb, #dfa11a 8%, transparent)',
      border: '#dfa11a'
    },
    danger: {
      bg: 'color-mix(in srgb, #ff847d 8%, transparent)',
      border: '#ff847d'
    },
    important: {
      bg: 'color-mix(in srgb, #a855f7 8%, transparent)',
      border: '#a855f7'
    },
    muted: {
      bg: 'color-mix(in srgb, #94a3b8 8%, transparent)',
      border: '#94a3b8'
    }
  }
} as const

export type CalloutPaletteKey = keyof typeof colors.callout

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
  if (type === 'librarian') return '#60b8d6' // oklch(0.75 0.12 220) distinct cyan
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

export const borderRadius = { container: 6, inline: 4, tool: 8, card: 0, round: '50%' } as const

/**
 * Z-index scale. Higher numbers paint on top.
 *
 * Layering principle: surface chrome (canvas HUD, sidebar tags) sits low, dock
 * and window chrome sits mid, popovers and menus sit high regardless of which
 * surface they originate from, modals above popovers, tooltips above modals.
 */
export const zIndex = {
  surfaceHud: 30,
  surfacePopover: 50,
  dockChrome: 40,
  dockPopover: 100,
  modal: 200,
  tooltip: 1000
} as const

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
  references: '#9887e8', // oklch(0.68 0.14 290) muted purple
  derived_from: '#5b8dd9' // oklch(0.65 0.12 260) muted blue — lineage relationship
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
  shadow: '0 8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.4)',
  shadowCompact: '0 4px 16px rgba(0,0,0,0.4), 0 1px 4px rgba(0,0,0,0.25)',
  glass: {
    bg: 'rgba(4, 4, 8, 0.90)',
    blur: 'blur(24px) saturate(1.4)',
    inputBg: 'rgba(255, 255, 255, 0.05)',
    inputBgFocus: 'rgba(255, 255, 255, 0.09)',
    popoverBg: 'rgba(4, 4, 8, 0.95)',
    popoverBlur: 'blur(16px) saturate(1.3)',
    sectionLabel: {
      fontSize: '10px',
      fontWeight: '600',
      textTransform: 'uppercase' as const,
      letterSpacing: '0.15em'
    }
  }
} as const
