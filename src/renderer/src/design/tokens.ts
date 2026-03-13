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
  default: '150ms ease-out'
} as const
