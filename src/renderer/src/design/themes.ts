// src/renderer/src/design/themes.ts

/** Default accent. "Ember" coral from the Console direction palette.
 * Overridable at runtime via `applyAccentCssVars(hex)`; settings will
 * eventually persist a chosen preset (see `accent-presets.ts`). */
export const ACCENT_HEX = '#ff8c5a'

/** OS-chrome layer (titlebar, status bar, deepest rail). Pulled from
 * `tokens.css` (#050508) — sits one shade off pure black so the chrome
 * reads as a recessed frame around the surface. */
export const CHROME_BG_HEX = '#050508'

/** Density of the row-grid: compact (22px), default (26px), comfy (32px).
 * Drives `--row-h`, `--ui-fs`, `--ui-fs-sm`, and panel padding. */
export type Density = 'compact' | 'default' | 'comfy'

/** Card / button / pill corner radii. `square` is the Linear-precision
 * default (0px / 2px / 4px); `soft` rounds everything off (6px / 4px / 8px). */
export type Radii = 'square' | 'soft'

/** Background tint variant. `pure` is true #000; `near-black` is a cool
 * navy-tinted near-black; `warm` is a warm coffee-tinted near-black. */
export type BackgroundTint = 'pure' | 'near-black' | 'warm'

export interface EnvironmentSettings {
  readonly cardOpacity: number
  readonly cardHeaderDarkness: number
  readonly cardBlur: number
  readonly gridDotVisibility: number
  readonly cardTitleFontSize: number
  readonly cardBodyFontSize: number
  readonly sidebarFontSize: number
  readonly density: Density
  readonly radii: Radii
  readonly backgroundTint: BackgroundTint
  readonly canvasGrid: boolean
}

export const ENV_DEFAULTS: EnvironmentSettings = {
  cardOpacity: 94,
  cardHeaderDarkness: 45,
  cardBlur: 9,
  gridDotVisibility: 7,
  cardTitleFontSize: 13,
  cardBodyFontSize: 16,
  sidebarFontSize: 13,
  density: 'default',
  radii: 'square',
  backgroundTint: 'pure',
  canvasGrid: true
}

interface BaseRgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

interface ThemeBaseColors {
  readonly canvasSurface: BaseRgb
  readonly cardBody: BaseRgb
}

// Pure-black base. The thread, sidebar, dock, and ribbon all read as the
// same #000 surface; canvas cards sit slightly lifted (cardBody) so they
// register as objects against the void.
export const BASE_COLORS: ThemeBaseColors = {
  canvasSurface: { r: 0, g: 0, b: 0 },
  cardBody: { r: 10, g: 10, b: 12 }
}

interface StructuralColors {
  readonly border: {
    readonly default: string
    readonly subtle: string
    readonly strong: string
  }
  readonly text: {
    readonly primary: string
    readonly secondary: string
    readonly muted: string
    readonly disabled: string
  }
  readonly canvas: {
    readonly cardBorder: string
    readonly textHeading: string
    readonly blockquoteBar: string
  }
}

// Hairline border palette per Linear-precision spec. Three steps of white
// alpha (faint / subtle / default / strong) so panel dividers feel like a
// continuous 1px grid that recedes against the pure-black canvas. Text
// follows the Geist gray ramp (Zinc 100 → Zinc 800) and pairs cleanly with
// the warm Ember accent.
export const STRUCTURAL_COLORS: StructuralColors = {
  border: {
    default: 'rgba(255, 255, 255, 0.12)',
    subtle: 'rgba(255, 255, 255, 0.08)',
    strong: 'rgba(255, 255, 255, 0.20)'
  },
  text: {
    primary: '#f4f4f5',
    secondary: '#a1a1aa',
    muted: '#71717a',
    disabled: '#52525b'
  },
  canvas: {
    cardBorder: 'rgba(255, 255, 255, 0.12)',
    textHeading: '#f4f4f5',
    blockquoteBar: 'rgba(255, 255, 255, 0.20)'
  }
}

/** Hairline alpha ramp emitted as `--line-faint/subtle/default/strong` so
 * components can pick the right step by name instead of guessing alphas. */
export const LINE_ALPHAS = {
  faint: 'rgba(255, 255, 255, 0.04)',
  subtle: 'rgba(255, 255, 255, 0.08)',
  default: 'rgba(255, 255, 255, 0.12)',
  strong: 'rgba(255, 255, 255, 0.20)'
} as const

/** Semantic signals — success/warn/danger/info — used by status bar dots,
 * pill tones, diff lines, and callouts. Kept in one place so callers don't
 * re-pick hexes per surface. */
export const SIGNAL_COLORS = {
  success: '#4ec983',
  warn: '#dfa11a',
  danger: '#ff847d',
  info: '#6dafff'
} as const

/** Per-artifact dot hues. Mirrors `ARTIFACT_COLORS` in `tokens.ts` so they
 * stay in sync if either is retuned; emitted as `--hue-*` CSS vars for
 * consumers that key off CSS rather than the typed map. */
export const ARTIFACT_HUES = {
  gene: '#00cca8',
  constraint: '#ff847d',
  research: '#ad9cff',
  output: '#ec86cc',
  note: '#a3afc1',
  index: '#00befa',
  session: '#4ec983',
  pattern: '#dfa11a',
  tension: '#fe838f'
} as const

/** Density → row height + UI font sizes + panel padding. Mirrors the
 * `[data-density="compact|default|comfy"]` blocks in `tokens.css`. */
export const DENSITY_VARS: Record<Density, Record<string, string>> = {
  compact: {
    '--row-h': '22px',
    '--ui-fs': '12px',
    '--ui-fs-sm': '11px',
    '--pad-panel-x': '12px',
    '--pad-panel-y': '8px'
  },
  default: {
    '--row-h': '26px',
    '--ui-fs': '13px',
    '--ui-fs-sm': '12px',
    '--pad-panel-x': '16px',
    '--pad-panel-y': '12px'
  },
  comfy: {
    '--row-h': '32px',
    '--ui-fs': '14px',
    '--ui-fs-sm': '13px',
    '--pad-panel-x': '20px',
    '--pad-panel-y': '16px'
  }
}

/** Radii presets. `square` matches the Linear hairline-square direction;
 * `soft` is the rounded-corner alternate. */
export const RADII_VARS: Record<Radii, Record<string, string>> = {
  square: {
    '--r-card': '0px',
    '--r-inline': '2px',
    '--r-tool': '4px'
  },
  soft: {
    '--r-card': '6px',
    '--r-inline': '4px',
    '--r-tool': '8px'
  }
}

interface BgVariant {
  readonly base: string
  readonly surface: string
  readonly elevated: string
  readonly chrome: string
  readonly rail: string
  readonly card: string
  readonly cardHover: string
}

/** Background tint variants. `pure` is true #000 (the default canvas);
 * `near-black` adds a cool navy lift; `warm` adds a coffee-brown lift. */
export const BACKGROUND_VARIANTS: Record<BackgroundTint, BgVariant> = {
  pure: {
    base: '#000000',
    surface: '#050507',
    elevated: '#0a0a0d',
    chrome: '#050508',
    rail: '#030305',
    card: '#0a0a0d',
    cardHover: '#0e0e12'
  },
  'near-black': {
    base: '#07080a',
    surface: '#0a0c0f',
    elevated: '#11141a',
    chrome: '#07080a',
    rail: '#04060a',
    card: '#11141a',
    cardHover: '#161a21'
  },
  warm: {
    base: '#0d0c0b',
    surface: '#131210',
    elevated: '#1a1816',
    chrome: '#0d0c0b',
    rail: '#08070605',
    card: '#1a1816',
    cardHover: '#211f1c'
  }
}

function parseHex(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ]
}

function lightenHex(hex: string, factor: number): string {
  const [r, g, b] = parseHex(hex)
  const lighten = (c: number): number => Math.min(255, Math.round(c + (255 - c) * factor))
  const toHex = (n: number): string => n.toString(16).padStart(2, '0')
  return `#${toHex(lighten(r))}${toHex(lighten(g))}${toHex(lighten(b))}`
}

export function computeAccentVariants(hex: string): {
  default: string
  hover: string
  muted: string
} {
  return {
    default: hex,
    hover: lightenHex(hex, 0.2),
    muted: `color-mix(in srgb, ${hex} 10%, transparent)`
  }
}
