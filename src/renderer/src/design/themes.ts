// src/renderer/src/design/themes.ts

export type ThemeId = 'dark' | 'light' | 'system'
export type ResolvedThemeId = 'dark' | 'light'

export type AccentColorId =
  | 'matrix'
  | 'laser'
  | 'synthwave'
  | 'hotpink'
  | 'arcade'
  | 'phosphor'
  | 'plasma'
  | 'neonmint'

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

export const ENV_DEFAULTS: Record<ResolvedThemeId, EnvironmentSettings> = {
  dark: {
    canvasTranslucency: 40,
    cardOpacity: 94,
    cardHeaderDarkness: 45,
    cardBlur: 12,
    gridDotVisibility: 20,
    panelLightness: 5,
    activityBarOpacity: 55,
    cardTitleFontSize: 12,
    sidebarFontSize: 13
  },
  light: {
    canvasTranslucency: 45,
    cardOpacity: 90,
    cardHeaderDarkness: 4,
    cardBlur: 8,
    gridDotVisibility: 15,
    panelLightness: 98,
    activityBarOpacity: 12,
    cardTitleFontSize: 12,
    sidebarFontSize: 13
  }
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

export const BASE_COLORS: Record<ResolvedThemeId, ThemeBaseColors> = {
  dark: {
    canvasSurface: { r: 18, g: 18, b: 20 },
    cardBody: { r: 16, g: 16, b: 20 }
  },
  light: {
    canvasSurface: { r: 232, g: 236, b: 240 },
    cardBody: { r: 255, g: 255, b: 255 }
  }
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

export const STRUCTURAL_COLORS: Record<ResolvedThemeId, StructuralColors> = {
  dark: {
    border: {
      default: 'color-mix(in srgb, white 8%, transparent)',
      subtle: 'color-mix(in srgb, white 4%, transparent)'
    },
    text: { primary: '#d9d9d9', secondary: '#808080', muted: '#525252' },
    canvas: {
      cardBorder: 'rgba(255, 255, 255, 0.06)',
      textHeading: '#e8e8e8',
      blockquoteBar: '#4a4a4a'
    }
  },
  light: {
    border: {
      default: '#e2e8f0',
      subtle: 'color-mix(in srgb, black 6%, transparent)'
    },
    text: { primary: '#0f172a', secondary: '#475569', muted: '#94a3b8' },
    canvas: {
      cardBorder: 'rgba(0, 0, 0, 0.06)',
      textHeading: '#0f172a',
      blockquoteBar: '#cbd5e1'
    }
  }
}

interface AccentDefinition {
  readonly label: string
  readonly value: string
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

export const ACCENT_COLORS: Record<AccentColorId, AccentDefinition> = {
  matrix: { label: 'Matrix', value: '#39ff14' },
  laser: { label: 'Laser', value: '#ff3131' },
  synthwave: { label: 'Synthwave', value: '#b026ff' },
  hotpink: { label: 'Hot Pink', value: '#ff10f0' },
  arcade: { label: 'Arcade', value: '#ffff33' },
  phosphor: { label: 'Phosphor', value: '#00ff87' },
  plasma: { label: 'Plasma', value: '#00d4ff' },
  neonmint: { label: 'Neon Mint', value: '#00ffcc' }
}

export const ACCENT_ORDER: readonly AccentColorId[] = [
  'matrix',
  'laser',
  'synthwave',
  'hotpink',
  'arcade',
  'phosphor',
  'plasma',
  'neonmint'
]
