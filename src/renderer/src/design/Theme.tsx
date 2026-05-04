import { createContext, useContext, useLayoutEffect, useMemo, type ReactNode } from 'react'
import { spacing, typography, transitions } from './tokens'
import {
  STRUCTURAL_COLORS,
  BASE_COLORS,
  CHROME_BG_HEX,
  ENV_DEFAULTS,
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
  // Sidebar / thread / dock surfaces are SOLID. The center (thread) reads
  // as the lit focal layer at `--color-bg-base`; side rails (sidebar +
  // dock + settings) recess by a user-tuned amount via `--color-bg-rail`.
  // `--color-bg-surface` and `--color-bg-elevated` are subtle hover lifts
  // for tab strips, pills, and active-row backgrounds.
  const lift = (amt: number): string => {
    const lc = (c: number): number => Math.min(255, Math.round(c + (255 - c) * amt))
    return `rgb(${lc(r)}, ${lc(g)}, ${lc(b)})`
  }
  const drop = (amt: number): string => {
    const dc = (c: number): number => Math.max(0, Math.round(c * (1 - amt)))
    return `rgb(${dc(r)}, ${dc(g)}, ${dc(b)})`
  }
  // activityBarOpacity (0-100) is reinterpreted as the rail recess percent:
  // 0 leaves rails identical to the thread; 100 drives them to pure black.
  const railRecess = Math.max(0, Math.min(100, env.activityBarOpacity)) / 100
  root.style.setProperty('--color-bg-base', `rgb(${r}, ${g}, ${b})`)
  root.style.setProperty('--color-bg-surface', lift(0.04))
  root.style.setProperty('--color-bg-elevated', lift(0.1))
  root.style.setProperty('--color-bg-rail', drop(railRecess))

  root.style.setProperty('--color-border-default', structural.border.default)
  root.style.setProperty('--border-subtle', structural.border.subtle)
  root.style.setProperty('--color-border-strong', structural.border.strong)
  root.style.setProperty('--color-text-primary', structural.text.primary)
  root.style.setProperty('--color-text-secondary', structural.text.secondary)
  root.style.setProperty('--color-text-muted', structural.text.muted)
  root.style.setProperty('--color-text-disabled', structural.text.disabled)
  root.style.setProperty('--color-bg-chrome', CHROME_BG_HEX)
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
