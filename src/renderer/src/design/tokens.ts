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
    cluster: '#34D399',
    tension: '#F59E0B'
  }
} as const

export const ARTIFACT_COLORS = {
  gene: '#22d3ee',
  constraint: '#ef4444',
  research: '#a78bfa',
  output: '#f472b6',
  note: '#94a3b8',
  index: '#38bdf8',
  session: '#10b981',
  pattern: '#f59e0b',
  tension: '#fb7185'
} as const satisfies Record<BuiltInArtifactType, string>

// Palette excludes colors already used by built-in types
const CUSTOM_TYPE_PALETTE = [
  '#c084fc', // purple (distinct from research #a78bfa)
  '#818cf8', // indigo
  '#34d399', // emerald
  '#facc15', // yellow
  '#fb923c', // orange
  '#f87171', // red-light (distinct from constraint #ef4444)
  '#2dd4bf', // teal
  '#a3e635', // lime
  '#fbbf24' // amber
] as const

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

export function getArtifactColor(type: string): string {
  if (type === 'tag') return '#f59e0b'
  const builtIn = (ARTIFACT_COLORS as Record<string, string>)[type]
  if (builtIn) return builtIn
  return CUSTOM_TYPE_PALETTE[hashString(type) % CUSTOM_TYPE_PALETTE.length]
}

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
    display: '"Inter", system-ui, sans-serif',
    body: '"Inter", system-ui, sans-serif',
    mono: '"JetBrains Mono", "Fira Code", monospace'
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

export const typeScale = {
  display: {
    pageTitle: { size: '20px', weight: 600, color: colors.text.primary },
    sectionHeading: { size: '15px', weight: 600, color: colors.text.primary },
    body: { size: '13px', weight: 400, color: colors.text.primary },
    secondary: { size: '12px', weight: 400, color: colors.text.secondary },
    label: {
      size: '12px',
      weight: 400,
      color: colors.text.muted,
      textTransform: 'uppercase' as const,
      letterSpacing: '0.05em'
    }
  },
  mono: { terminal: { size: '13px' }, source: { size: '12px' }, inline: { size: '12px' } },
  minSize: '12px'
} as const

export const borderRadius = { container: 6, inline: 4, card: 0, round: '50%' } as const

/* ── Visual Language ──────────────────────────────────────────────────────
 * Edge-to-edge panel aesthetic with thin perpendicular divider lines.
 * Panels sit flush, separated by 1px lines. Depth via background contrast.
 * Tab bars use --border-subtle for their 1px bottom separator.
 */
export const visualLanguage = {
  panelGap: 0,
  cardRadius: 0,
  borderSubtle: 'rgba(255, 255, 255, 0.08)'
} as const

export const EDGE_KIND_COLORS: Record<string, string> = {
  connection: '#64748b',
  cluster: '#34d399',
  tension: '#f59e0b',
  related: '#a78bfa'
} as const

export const canvasTokens = {
  surface: 'var(--canvas-surface-bg)',
  card: 'var(--canvas-card-bg)',
  cardTitleBar: 'var(--canvas-card-title-bg)',
  cardBorder: 'var(--canvas-card-border)',
  textHeading: 'var(--canvas-text-heading)',
  blockquoteBar: 'var(--canvas-blockquote-bar)',
  cardRadius: 6,
  titleBarHeight: 34,
  contentPadding: 24,
  badgeGreen: '#4caf50',
  linkCyan: '#5cb8c4'
} as const

export const floatingPanel = {
  borderRadius: 12,
  shadow:
    '0 8px 32px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.09), inset 0 -1px 0 rgba(0,0,0,0.2), inset 0 0 0 1px rgba(255,255,255,0.05)',
  shadowCompact:
    '0 4px 16px rgba(0,0,0,0.35), 0 1px 4px rgba(0,0,0,0.2), inset 0 0.5px 0 rgba(255,255,255,0.1), inset 0 0 0 1px rgba(255,255,255,0.05)',
  shadowCard:
    '0 4px 20px rgba(0,0,0,0.35), 0 1px 4px rgba(0,0,0,0.2), inset 0 0 0 1px rgba(255,255,255,0.06)',
  shadowCardSelected: '0 0 0 1.5px var(--color-accent-default), 0 4px 24px rgba(0,0,0,0.4)',
  blur: {
    sidebar: 'blur(24px) saturate(1.3)',
    compact: 'blur(8px) saturate(1.2)'
  }
} as const

export const animations = {
  spatialTransition: '250ms ease-out'
} as const
