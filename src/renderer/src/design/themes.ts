// src/renderer/src/design/themes.ts

/** Hardcoded accent color -- neutral white (matches text-primary) */
export const ACCENT_HEX = '#d9d9d9'

export interface EnvironmentSettings {
  readonly canvasTranslucency: number
  readonly cardOpacity: number
  readonly cardHeaderDarkness: number
  readonly cardBlur: number
  readonly gridDotVisibility: number
  readonly panelLightness: number
  readonly activityBarOpacity: number
  readonly cardTitleFontSize: number
  readonly sidebarFontSize: number
}

export const ENV_DEFAULTS: EnvironmentSettings = {
  canvasTranslucency: 40,
  cardOpacity: 94,
  cardHeaderDarkness: 45,
  cardBlur: 12,
  gridDotVisibility: 20,
  panelLightness: 5,
  activityBarOpacity: 55,
  cardTitleFontSize: 12,
  sidebarFontSize: 13
}

export interface BaseRgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

export interface ThemeBaseColors {
  readonly canvasSurface: BaseRgb
  readonly cardBody: BaseRgb
}

export const BASE_COLORS: ThemeBaseColors = {
  canvasSurface: { r: 18, g: 18, b: 20 },
  cardBody: { r: 16, g: 16, b: 20 }
}

export interface StructuralColors {
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
    default: 'rgba(255, 255, 255, 0.10)',
    subtle: 'rgba(255, 255, 255, 0.05)'
  },
  text: { primary: '#d9d9d9', secondary: '#808080', muted: '#525252' },
  canvas: {
    cardBorder: 'rgba(255, 255, 255, 0.06)',
    textHeading: '#e8e8e8',
    blockquoteBar: '#4a4a4a'
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
