import { createContext, useContext, useLayoutEffect, useMemo, type ReactNode } from 'react'
import { spacing, typography, transitions } from './tokens'
import {
  STRUCTURAL_COLORS,
  BASE_COLORS,
  ACCENT_HEX,
  ENV_DEFAULTS,
  computeAccentVariants,
  type EnvironmentSettings
} from './themes'
import { useSettingsStore } from '../store/settings-store'

interface EnvContext {
  readonly cardBlur: number
  readonly gridDotVisibility: number
  readonly activityBarOpacity: number
  readonly cardTitleFontSize: number
  readonly sidebarFontSize: number
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
    activityBarOpacity: ENV_DEFAULTS.activityBarOpacity,
    cardTitleFontSize: ENV_DEFAULTS.cardTitleFontSize,
    sidebarFontSize: ENV_DEFAULTS.sidebarFontSize
  }
})

function applyEnvCssVars(env: EnvironmentSettings): void {
  const root = document.documentElement
  const base = BASE_COLORS
  const structural = STRUCTURAL_COLORS

  const surfaceOpacity = (100 - env.canvasTranslucency) / 100
  root.style.setProperty(
    '--canvas-surface-bg',
    `rgba(${base.canvasSurface.r}, ${base.canvasSurface.g}, ${base.canvasSurface.b}, ${surfaceOpacity})`
  )

  const cardOp = env.cardOpacity / 100
  root.style.setProperty(
    '--canvas-card-bg',
    `rgba(${base.cardBody.r}, ${base.cardBody.g}, ${base.cardBody.b}, ${cardOp})`
  )

  root.style.setProperty('--canvas-card-title-bg', `rgba(0, 0, 0, ${env.cardHeaderDarkness / 100})`)

  const { r, g, b } = base.canvasSurface
  const railOp = env.activityBarOpacity / 100
  root.style.setProperty('--color-bg-base', `rgba(${r}, ${g}, ${b}, ${railOp})`)
  root.style.setProperty(
    '--color-bg-surface',
    `rgba(${r}, ${g}, ${b}, ${Math.min(railOp + 0.07, 1)})`
  )
  root.style.setProperty(
    '--color-bg-elevated',
    `rgba(${r}, ${g}, ${b}, ${Math.min(railOp + 0.13, 1)})`
  )

  root.style.setProperty('--color-border-default', structural.border.default)
  root.style.setProperty('--border-subtle', structural.border.subtle)
  root.style.setProperty('--color-text-primary', structural.text.primary)
  root.style.setProperty('--color-text-secondary', structural.text.secondary)
  root.style.setProperty('--color-text-muted', structural.text.muted)
  root.style.setProperty('--canvas-card-border', structural.canvas.cardBorder)
  root.style.setProperty('--canvas-text-heading', structural.canvas.textHeading)
  root.style.setProperty('--canvas-blockquote-bar', structural.canvas.blockquoteBar)
  root.style.setProperty(
    '--chrome-rail-bg',
    `rgba(${base.canvasSurface.r}, ${base.canvasSurface.g}, ${base.canvasSurface.b}, ${env.activityBarOpacity / 100})`
  )
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

function applyAccentCssVars(): void {
  const root = document.documentElement
  const accent = computeAccentVariants(ACCENT_HEX)
  root.style.setProperty('--color-accent-default', accent.default)
  root.style.setProperty('--color-accent-hover', accent.hover)
  root.style.setProperty('--color-accent-muted', accent.muted)

  const [r, g, b] = [
    parseInt(ACCENT_HEX.slice(1, 3), 16),
    parseInt(ACCENT_HEX.slice(3, 5), 16),
    parseInt(ACCENT_HEX.slice(5, 7), 16)
  ]
  root.style.setProperty('--neon-glow', `0 0 8px rgba(${r}, ${g}, ${b}, 0.15)`)
  root.style.setProperty('--color-accent-focus', `rgba(${r}, ${g}, ${b}, 0.3)`)
  root.style.setProperty('--color-accent-subtle', `rgba(${r}, ${g}, ${b}, 0.15)`)
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const env = useSettingsStore((s) => s.env)

  useLayoutEffect(() => {
    applyEnvCssVars(env)
  }, [env])

  useLayoutEffect(() => {
    applyAccentCssVars()
  }, [])

  const ctx = useMemo<ThemeContextType>(
    () => ({
      spacing,
      typography,
      transitions,
      env: {
        cardBlur: env.cardBlur,
        gridDotVisibility: env.gridDotVisibility,
        activityBarOpacity: env.activityBarOpacity,
        cardTitleFontSize: env.cardTitleFontSize,
        sidebarFontSize: env.sidebarFontSize
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
