import { createContext, useContext, useLayoutEffect, useMemo, type ReactNode } from 'react'
import { spacing, typography, transitions } from './tokens'
import {
  STRUCTURAL_COLORS,
  CHROME_BG_HEX,
  ENV_DEFAULTS,
  LINE_ALPHAS,
  SIGNAL_COLORS,
  ARTIFACT_HUES,
  DENSITY_VARS,
  RADII_VARS,
  BACKGROUND_VARIANTS,
  type EnvironmentSettings
} from './themes'
import { applyAccentCssVars } from './apply-accent'
import { ACCENT_PRESETS, type AccentId } from './accent-presets'
import { useSettingsStore } from '../store/settings-store'

function resolveAccentHex(accentId: AccentId, customHex: string): string {
  if (accentId === 'custom') return customHex
  const preset = ACCENT_PRESETS.find((p) => p.id === accentId)
  return preset?.hex ?? customHex
}

interface EnvContext {
  readonly cardBlur: number
  readonly gridDotVisibility: number
  readonly cardTitleFontSize: number
  readonly sidebarFontSize: number
  readonly canvasGrid: boolean
}

interface ThemeContextType {
  spacing: typeof spacing
  typography: typeof typography
  transitions: typeof transitions
  env: EnvContext
}

const ThemeContext = createContext<ThemeContextType>({
  spacing,
  typography,
  transitions,
  env: {
    cardBlur: ENV_DEFAULTS.cardBlur,
    gridDotVisibility: ENV_DEFAULTS.gridDotVisibility,
    cardTitleFontSize: ENV_DEFAULTS.cardTitleFontSize,
    sidebarFontSize: ENV_DEFAULTS.sidebarFontSize,
    canvasGrid: ENV_DEFAULTS.canvasGrid
  }
})

function applyEnvCssVars(env: EnvironmentSettings): void {
  const root = document.documentElement
  const structural = STRUCTURAL_COLORS
  const bg = BACKGROUND_VARIANTS[env.backgroundTint] ?? BACKGROUND_VARIANTS.pure

  // ── Background ramp (per tint variant) ──
  const parseHex = (hex: string): [number, number, number] => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ]
  const [r, g, b] = parseHex(bg.base)
  root.style.setProperty('--canvas-surface-bg', `rgb(${r}, ${g}, ${b})`)

  const cardOp = env.cardOpacity / 100
  const [cr, cg, cb] = parseHex(bg.card)
  root.style.setProperty('--canvas-card-bg', `rgba(${cr}, ${cg}, ${cb}, ${cardOp})`)
  root.style.setProperty('--canvas-card-title-bg', `rgba(0, 0, 0, ${env.cardHeaderDarkness / 100})`)

  root.style.setProperty('--color-bg-base', bg.base)
  root.style.setProperty('--color-bg-surface', bg.surface)
  root.style.setProperty('--color-bg-elevated', bg.elevated)
  root.style.setProperty('--color-bg-chrome', bg.chrome)
  root.style.setProperty('--color-bg-rail', bg.rail)
  root.style.setProperty('--bg-card', bg.card)
  root.style.setProperty('--bg-card-hover', bg.cardHover)
  root.style.setProperty('--bg-overlay', 'rgba(0, 0, 0, 0.72)')

  // Accent-tinted surface fills (referenced by pills, vault card, palette).
  root.style.setProperty(
    '--bg-tint-accent',
    'color-mix(in srgb, var(--color-accent-default) 8%, transparent)'
  )
  root.style.setProperty(
    '--bg-tint-accent-strong',
    'color-mix(in srgb, var(--color-accent-default) 14%, transparent)'
  )
  root.style.setProperty(
    '--bg-tint-text',
    'color-mix(in srgb, var(--color-text-primary) 4%, transparent)'
  )

  // ── Hairlines: alpha ramp + back-compat aliases ──
  root.style.setProperty('--line-faint', LINE_ALPHAS.faint)
  root.style.setProperty('--line-subtle', LINE_ALPHAS.subtle)
  root.style.setProperty('--line-default', LINE_ALPHAS.default)
  root.style.setProperty('--line-strong', LINE_ALPHAS.strong)
  root.style.setProperty('--color-border-default', structural.border.default)
  root.style.setProperty('--border-subtle', structural.border.subtle)
  root.style.setProperty('--color-border-subtle', structural.border.subtle)
  root.style.setProperty('--color-border-strong', structural.border.strong)

  // ── Text ──
  root.style.setProperty('--color-text-primary', structural.text.primary)
  root.style.setProperty('--color-text-secondary', structural.text.secondary)
  root.style.setProperty('--color-text-muted', structural.text.muted)
  root.style.setProperty('--color-text-disabled', structural.text.disabled)
  root.style.setProperty(
    '--color-text-faint',
    'rgba(255, 255, 255, 0.18)' /* "fg-faint" — below disabled */
  )

  // ── Chrome ──
  root.style.setProperty('--color-bg-chrome', CHROME_BG_HEX)
  root.style.setProperty('--canvas-card-border', structural.canvas.cardBorder)
  root.style.setProperty('--canvas-text-heading', structural.canvas.textHeading)
  root.style.setProperty('--canvas-blockquote-bar', structural.canvas.blockquoteBar)

  // ── Signals ──
  root.style.setProperty('--signal-success', SIGNAL_COLORS.success)
  root.style.setProperty('--signal-warn', SIGNAL_COLORS.warn)
  root.style.setProperty('--signal-danger', SIGNAL_COLORS.danger)
  root.style.setProperty('--signal-info', SIGNAL_COLORS.info)

  // ── Artifact hues (graph nodes, dots, badges) ──
  for (const [key, value] of Object.entries(ARTIFACT_HUES)) {
    root.style.setProperty(`--hue-${key}`, value)
  }

  // ── Density / radii (live-tweakable) ──
  root.dataset.density = env.density
  root.dataset.radii = env.radii
  root.dataset.bg = env.backgroundTint
  for (const [key, value] of Object.entries(DENSITY_VARS[env.density])) {
    root.style.setProperty(key, value)
  }
  for (const [key, value] of Object.entries(RADII_VARS[env.radii])) {
    root.style.setProperty(key, value)
  }
  root.style.setProperty('--r-pill', '999px')

  // ── Env-driven font sizes (already user-tweakable) ──
  root.style.setProperty('--env-card-blur', `${env.cardBlur}px`)
  root.style.setProperty('--env-card-title-font-size', `${env.cardTitleFontSize}px`)
  root.style.setProperty('--env-card-body-font-size', `${env.cardBodyFontSize}px`)
  root.style.setProperty(
    '--env-card-code-font-size',
    `${Math.max(Math.round(env.cardBodyFontSize * 0.75), 10)}px`
  )
  root.style.setProperty('--env-sidebar-font-size', `${env.sidebarFontSize}px`)
  root.style.setProperty(
    '--env-sidebar-secondary-font-size',
    `${Math.max(env.sidebarFontSize - 1, 11)}px`
  )
  root.style.setProperty(
    '--env-sidebar-tertiary-font-size',
    `${Math.max(env.sidebarFontSize - 3, 10)}px`
  )
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const env = useSettingsStore((s) => s.env)
  const accentId = useSettingsStore((s) => s.accentId)
  const customAccentHex = useSettingsStore((s) => s.customAccentHex)

  useLayoutEffect(() => {
    applyEnvCssVars(env)
  }, [env])

  useLayoutEffect(() => {
    applyAccentCssVars(resolveAccentHex(accentId, customAccentHex))
  }, [accentId, customAccentHex])

  const ctx = useMemo<ThemeContextType>(
    () => ({
      spacing,
      typography,
      transitions,
      env: {
        cardBlur: env.cardBlur,
        gridDotVisibility: env.gridDotVisibility,
        cardTitleFontSize: env.cardTitleFontSize,
        sidebarFontSize: env.sidebarFontSize,
        canvasGrid: env.canvasGrid
      }
    }),
    [env]
  )

  return <ThemeContext.Provider value={ctx}>{children}</ThemeContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useEnv(): EnvContext {
  return useContext(ThemeContext).env
}
