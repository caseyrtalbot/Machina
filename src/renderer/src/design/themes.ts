// src/renderer/src/design/themes.ts

/** Hardcoded accent color -- near-white for high contrast against dark base */
export const ACCENT_HEX = '#ebebeb'

export interface EnvironmentSettings {
  readonly canvasTranslucency: number
  readonly cardOpacity: number
  readonly cardHeaderDarkness: number
  readonly cardBlur: number
  readonly gridDotVisibility: number
  readonly activityBarOpacity: number
  readonly cardTitleFontSize: number
  readonly cardBodyFontSize: number
  readonly sidebarFontSize: number
}

export const ENV_DEFAULTS: EnvironmentSettings = {
  canvasTranslucency: 0,
  cardOpacity: 94,
  cardHeaderDarkness: 45,
  cardBlur: 9,
  gridDotVisibility: 20,
  activityBarOpacity: 40,
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

export const BASE_COLORS: ThemeBaseColors = {
  canvasSurface: { r: 8, g: 8, b: 10 },
  cardBody: { r: 10, g: 10, b: 14 }
}

interface StructuralColors {
  readonly border: { readonly default: string; readonly subtle: string }
  readonly text: { readonly primary: string; readonly secondary: string; readonly muted: string }
  readonly canvas: {
    readonly cardBorder: string
    readonly textHeading: string
    readonly blockquoteBar: string
  }
}

export const STRUCTURAL_COLORS: StructuralColors = {
  border: {
    default: 'rgba(255, 255, 255, 0.20)',
    subtle: 'rgba(255, 255, 255, 0.14)'
  },
  text: { primary: '#ebebeb', secondary: '#9a9a9a', muted: '#585858' },
  canvas: {
    cardBorder: 'rgba(255, 255, 255, 0.18)',
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
