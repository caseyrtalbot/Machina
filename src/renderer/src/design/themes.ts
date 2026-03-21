export type ThemeId = 'midnight' | 'slate' | 'obsidian' | 'nord' | 'evergreen' | 'light'
export type AccentColorId =
  | 'matrix'
  | 'laser'
  | 'synthwave'
  | 'hotpink'
  | 'arcade'
  | 'phosphor'
  | 'plasma'
  | 'neonmint'

interface CanvasColors {
  surface: string
  card: string
  cardTitleBar: string
  cardBorder: string
  textHeading: string
  blockquoteBar: string
}

interface StructuralColors {
  bg: { base: string; surface: string; elevated: string }
  border: { default: string; subtle: string }
  text: { primary: string; secondary: string; muted: string }
  canvas: CanvasColors
}

export interface ThemeDefinition {
  label: string
  colors: StructuralColors
}

export interface AccentDefinition {
  label: string
  value: string
}

export interface ResolvedColors {
  bg: { base: string; surface: string; elevated: string }
  border: { default: string; subtle: string }
  text: { primary: string; secondary: string; muted: string }
  accent: { default: string; hover: string; muted: string }
  semantic: { cluster: string; tension: string }
  canvas: CanvasColors
}

// ── Color math ──────────────────────────────────────────────────────────

function parseHex(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ]
}

function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
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
    muted: hexToRgba(hex, 0.1)
  }
}

export function resolveColors(themeId: ThemeId, accentId: AccentColorId): ResolvedColors {
  const theme = THEMES[themeId]
  const accentHex = ACCENT_COLORS[accentId].value
  return {
    ...theme.colors,
    accent: computeAccentVariants(accentHex),
    semantic: { cluster: '#34D399', tension: '#F59E0B' },
    canvas: theme.colors.canvas
  }
}

// ── Theme palettes ──────────────────────────────────────────────────────

export const THEMES = {
  midnight: {
    label: 'Midnight',
    colors: {
      bg: { base: '#141414', surface: '#1f1f1f', elevated: '#2a2a2a' },
      border: { default: 'rgba(255, 255, 255, 0.08)', subtle: 'rgba(255, 255, 255, 0.04)' },
      text: { primary: '#d9d9d9', secondary: '#808080', muted: '#525252' },
      canvas: {
        surface: '#1e1e1e',
        card: '#2b2d2f',
        cardTitleBar: '#252728',
        cardBorder: 'rgba(255, 255, 255, 0.06)',
        textHeading: '#e8e8e8',
        blockquoteBar: '#4a4a4a'
      }
    }
  },
  slate: {
    label: 'Slate',
    colors: {
      bg: { base: '#0f172a', surface: '#1e293b', elevated: '#334155' },
      border: { default: '#475569', subtle: 'rgba(255, 255, 255, 0.08)' },
      text: { primary: '#f1f5f9', secondary: '#94a3b8', muted: '#64748b' },
      canvas: {
        surface: '#1a2332',
        card: '#2a3a4e',
        cardTitleBar: '#222f42',
        cardBorder: 'rgba(255, 255, 255, 0.06)',
        textHeading: '#e2e8f0',
        blockquoteBar: '#475569'
      }
    }
  },
  obsidian: {
    label: 'Obsidian',
    colors: {
      bg: { base: '#1e1e1e', surface: '#252525', elevated: '#2d2d2d' },
      border: { default: '#3e3e3e', subtle: 'rgba(255, 255, 255, 0.06)' },
      text: { primary: '#dcddde', secondary: '#999999', muted: '#666666' },
      canvas: {
        surface: '#222222',
        card: '#2e2e2e',
        cardTitleBar: '#282828',
        cardBorder: 'rgba(255, 255, 255, 0.06)',
        textHeading: '#e0e0e0',
        blockquoteBar: '#484848'
      }
    }
  },
  nord: {
    label: 'Nord',
    colors: {
      bg: { base: '#2e3440', surface: '#3b4252', elevated: '#434c5e' },
      border: { default: '#4c566a', subtle: 'rgba(255, 255, 255, 0.08)' },
      text: { primary: '#eceff4', secondary: '#d8dee9', muted: '#7b88a1' },
      canvas: {
        surface: '#343a48',
        card: '#404958',
        cardTitleBar: '#3a424e',
        cardBorder: 'rgba(255, 255, 255, 0.06)',
        textHeading: '#eceff4',
        blockquoteBar: '#4c566a'
      }
    }
  },
  evergreen: {
    label: 'Opal',
    colors: {
      bg: { base: '#0c0c0e', surface: '#131315', elevated: '#1c1c1f' },
      border: { default: '#2a2a2d', subtle: 'rgba(255, 255, 255, 0.06)' },
      text: { primary: '#e6e8ec', secondary: '#8b8e96', muted: '#4a4c54' },
      canvas: {
        surface: '#111113',
        card: '#1a1a1d',
        cardTitleBar: '#161618',
        cardBorder: 'rgba(255, 255, 255, 0.06)',
        textHeading: '#e6e8ec',
        blockquoteBar: '#3a3a3e'
      }
    }
  },
  light: {
    label: 'Light',
    colors: {
      bg: { base: '#ffffff', surface: '#f8fafc', elevated: '#f1f5f9' },
      border: { default: '#e2e8f0', subtle: 'rgba(0, 0, 0, 0.06)' },
      text: { primary: '#0f172a', secondary: '#475569', muted: '#94a3b8' },
      canvas: {
        surface: '#f0f2f4',
        card: '#ffffff',
        cardTitleBar: '#f5f7f9',
        cardBorder: 'rgba(0, 0, 0, 0.08)',
        textHeading: '#0f172a',
        blockquoteBar: '#cbd5e1'
      }
    }
  }
} as const satisfies Record<ThemeId, ThemeDefinition>

// ── Accent colors ───────────────────────────────────────────────────────

export const ACCENT_COLORS = {
  matrix: { label: 'Matrix', value: '#39ff14' },
  laser: { label: 'Laser', value: '#ff3131' },
  synthwave: { label: 'Synthwave', value: '#b026ff' },
  hotpink: { label: 'Hot Pink', value: '#ff10f0' },
  arcade: { label: 'Arcade', value: '#ffff33' },
  phosphor: { label: 'Phosphor', value: '#00ff87' },
  plasma: { label: 'Plasma', value: '#00d4ff' },
  neonmint: { label: 'Neon Mint', value: '#00ffcc' }
} as const satisfies Record<AccentColorId, AccentDefinition>

// ── Ordering for UI display ─────────────────────────────────────────────

export const THEME_ORDER = [
  'midnight',
  'slate',
  'obsidian',
  'nord',
  'evergreen',
  'light'
] as const satisfies readonly ThemeId[]

export const ACCENT_ORDER = [
  'matrix',
  'laser',
  'synthwave',
  'hotpink',
  'arcade',
  'phosphor',
  'plasma',
  'neonmint'
] as const satisfies readonly AccentColorId[]
