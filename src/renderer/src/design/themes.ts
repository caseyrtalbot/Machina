// src/renderer/src/design/themes.ts

/** The accent. "Ember" coral from the Console direction palette — a ratified
 * constant (ADR 0005), applied at runtime via `applyAccentCssVars()`. */
export const ACCENT_HEX = '#ff8c5a'

/** OS-chrome layer (titlebar, status bar, deepest rail). Pulled from
 * `tokens.css` (#050508) — sits one shade off pure black so the chrome
 * reads as a recessed frame around the surface. */
export const CHROME_BG_HEX = '#050508'

/** Fixed background ramp (ADR 0005). Pure-black base with near-black lifts
 * for surface / elevated / card layers. */
export const BACKGROUND = {
  base: '#000000',
  surface: '#050507',
  elevated: '#0a0a0d',
  chrome: '#050508',
  rail: '#030305',
  card: '#0a0a0d',
  cardHover: '#0e0e12'
} as const

/** Fixed density vars: row height, UI font sizes, panel padding. */
export const DENSITY_DEFAULT_VARS: Record<string, string> = {
  '--row-h': '26px',
  '--ui-fs': '13px',
  '--ui-fs-sm': '12px',
  '--pad-panel-x': '16px',
  '--pad-panel-y': '12px'
}

/** Fixed knife-edge radii: every corner square (0px). */
export const RADII_SQUARE_VARS: Record<string, string> = {
  '--r-card': '0px',
  '--r-inline': '0px',
  '--r-tool': '0px'
}

// Fixed canvas / chrome constants (former appearance settings, now ratified).
export const CARD_BLUR_PX = 9
export const CARD_TITLE_FONT_SIZE_PX = 13
export const CARD_BODY_FONT_SIZE_PX = 16
export const SIDEBAR_FONT_SIZE_PX = 13
export const GRID_DOT_VISIBILITY = 7
export const CANVAS_GRID_ENABLED = true
export const CARD_OPACITY = 94
export const CARD_HEADER_DARKNESS = 45

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
