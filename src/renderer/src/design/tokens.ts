import type { ArtifactType } from '@shared/types'

export const colors = {
  bg: {
    base: '#0A0A0B',
    surface: '#111113',
    elevated: '#1A1A1D'
  },
  border: {
    default: '#2A2A2E'
  },
  text: {
    primary: '#EDEDEF',
    secondary: '#8B8B8E',
    muted: '#5A5A5E'
  },
  accent: {
    default: '#6C63FF',
    hover: '#7B73FF',
    muted: 'rgba(108, 99, 255, 0.12)'
  },
  semantic: {
    cluster: '#34D399',
    tension: '#F59E0B'
  }
} as const

export const ARTIFACT_COLORS: Record<ArtifactType, string> = {
  gene: '#6C63FF',
  constraint: '#EF4444',
  research: '#2DD4BF',
  output: '#EC4899',
  note: '#8B8B8E',
  index: '#38BDF8'
}

export const spacing = {
  unit: 4,
  panelGap: 1,
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

export const borderRadius = { container: 6, inline: 4, round: '50%' } as const

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
