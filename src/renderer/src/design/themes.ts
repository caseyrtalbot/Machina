// src/renderer/src/design/themes.ts

/** Default accent. "Ember" coral from the Console direction palette.
 * Overridable at runtime via `applyAccentCssVars(hex)`; settings will
 * eventually persist a chosen preset (see `accent-presets.ts`). */
export const ACCENT_HEX = '#ff8c5a'

/** Cool blue-slate chrome layer (titlebar, status bar, deepest rail).
 * One step darker than the canvas surface so the OS chrome reads as
 * a recessed frame around the surface. */
export const CHROME_BG_HEX = '#070a0e'

export interface EnvironmentSettings {
  readonly cardOpacity: number
  readonly cardHeaderDarkness: number
  readonly cardBlur: number
  readonly gridDotVisibility: number
  readonly cardTitleFontSize: number
  readonly cardBodyFontSize: number
  readonly sidebarFontSize: number
}

export const ENV_DEFAULTS: EnvironmentSettings = {
  cardOpacity: 94,
  cardHeaderDarkness: 45,
  cardBlur: 9,
  gridDotVisibility: 20,
  cardTitleFontSize: 13,
  cardBodyFontSize: 16,
  sidebarFontSize: 13
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

// Neutral gray-black hairline / text palette. Borders are white-tinted so they
// stay legible against the solid #111113 surface; text returns to a near-white
// → muted-gray scale that pairs cleanly with the warm Ember accent.
export const STRUCTURAL_COLORS: StructuralColors = {
  border: {
    default: 'rgba(255, 255, 255, 0.18)',
    subtle: 'rgba(255, 255, 255, 0.08)',
    strong: 'rgba(255, 255, 255, 0.28)'
  },
  text: {
    primary: '#ebebeb',
    secondary: '#9a9a9a',
    muted: '#585858',
    disabled: '#3e3e3e'
  },
  canvas: {
    cardBorder: 'rgba(255, 255, 255, 0.16)',
    textHeading: '#f2f2f2',
    blockquoteBar: '#555555'
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
