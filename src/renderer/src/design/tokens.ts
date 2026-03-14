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

/** Resolve a CSS custom property to its computed hex value (for Canvas 2D contexts). */
export function getComputedCssColor(varName: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
}

export const ARTIFACT_COLORS: Record<BuiltInArtifactType, string> = {
  gene: '#22d3ee',
  constraint: '#ef4444',
  research: '#a78bfa',
  output: '#f472b6',
  note: '#94a3b8',
  index: '#38bdf8'
}

export const DEFAULT_ARTIFACT_COLOR = '#94a3b8'

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
  panelGap: 4,
  contentPadX: 32,
  contentPadY: 24,
  sidebarWidth: 260,
  terminalMinWidth: 320
} as const

export const typography = {
  fontFamily: {
    display: 'Inter, system-ui, sans-serif',
    body: 'Inter, system-ui, sans-serif',
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

export const borderRadius = { container: 6, inline: 4, card: 8, round: '50%' } as const

/* ── Visual Language ──────────────────────────────────────────────────────
 * Named tokens for the floating-card panel aesthetic.
 * Use these in CSS via var(--panel-gap), var(--panel-radius), var(--border-subtle).
 *
 * Panels render as cards inset from the app chrome and each other by --panel-gap.
 * Depth comes from background-contrast (surface on base), not drop shadows.
 * Tab bars use --border-subtle for their 1px bottom separator.
 */
export const visualLanguage = {
  panelGap: 4,
  cardRadius: 8,
  borderSubtle: 'rgba(255, 255, 255, 0.08)'
} as const

export const animations = {
  graphNodeHoverGlow: '200ms ease-out',
  graphNetworkReveal: '200ms ease-out',
  graphNetworkDim: '300ms ease-out',
  graphNodeEnter: '400ms ease-out',
  graphNodeExit: '200ms ease-out',
  spatialTransition: '250ms ease-out'
} as const

export const focusRing = {
  color: colors.accent.default,
  opacity: 0.3,
  offset: 2,
  width: 2
} as const
