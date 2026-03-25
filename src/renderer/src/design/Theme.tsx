import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode
} from 'react'
import { spacing, typography, transitions } from './tokens'
import {
  STRUCTURAL_COLORS,
  BASE_COLORS,
  computeAccentVariants,
  ACCENT_COLORS,
  type ResolvedThemeId,
  type EnvironmentSettings
} from './themes'
import { useSettingsStore, resolveTheme } from '../store/settings-store'

interface EnvContext {
  readonly cardBlur: number
  readonly gridDotVisibility: number
  readonly activityBarOpacity: number
  readonly cardTitleFontSize: number
  readonly sidebarFontSize: number
  readonly resolvedTheme: ResolvedThemeId
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
    cardBlur: 12,
    gridDotVisibility: 20,
    activityBarOpacity: 55,
    cardTitleFontSize: 12,
    sidebarFontSize: 13,
    resolvedTheme: 'dark'
  }
})

const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)'

function subscribeToSystemTheme(onStoreChange: () => void): () => void {
  const mq = window.matchMedia(SYSTEM_THEME_QUERY)
  const handler = () => onStoreChange()
  mq.addEventListener('change', handler)
  return () => mq.removeEventListener('change', handler)
}

function getSystemResolvedTheme(): ResolvedThemeId {
  return window.matchMedia(SYSTEM_THEME_QUERY).matches ? 'dark' : 'light'
}

function subscribeToNothing(_onStoreChange: () => void): () => void {
  return () => {}
}

function useResolvedTheme(): ResolvedThemeId {
  const theme = useSettingsStore((s) => s.theme)
  const systemResolved = useSyncExternalStore(
    theme === 'system' ? subscribeToSystemTheme : subscribeToNothing,
    getSystemResolvedTheme,
    () => resolveTheme('dark')
  )

  return theme === 'system' ? systemResolved : theme
}

function applyEnvCssVars(resolved: ResolvedThemeId, env: EnvironmentSettings): void {
  const root = document.documentElement
  const base = BASE_COLORS[resolved]
  const structural = STRUCTURAL_COLORS[resolved]

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

  const l = env.panelLightness
  root.style.setProperty('--color-bg-base', `hsl(0, 0%, ${l}%)`)
  root.style.setProperty('--color-bg-surface', `hsl(0, 0%, ${Math.min(l + 7, 100)}%)`)
  root.style.setProperty('--color-bg-elevated', `hsl(0, 0%, ${Math.min(l + 13, 100)}%)`)

  root.style.setProperty('--color-border-default', structural.border.default)
  root.style.setProperty('--border-subtle', structural.border.subtle)
  root.style.setProperty('--color-text-primary', structural.text.primary)
  root.style.setProperty('--color-text-secondary', structural.text.secondary)
  root.style.setProperty('--color-text-muted', structural.text.muted)
  root.style.setProperty('--canvas-card-border', structural.canvas.cardBorder)
  root.style.setProperty('--canvas-text-heading', structural.canvas.textHeading)
  root.style.setProperty('--canvas-blockquote-bar', structural.canvas.blockquoteBar)
}

function applyAccentCssVars(accentHex: string): void {
  const root = document.documentElement
  const accent = computeAccentVariants(accentHex)
  root.style.setProperty('--color-accent-default', accent.default)
  root.style.setProperty('--color-accent-hover', accent.hover)
  root.style.setProperty('--color-accent-muted', accent.muted)

  if (accentHex.startsWith('#') && accentHex.length === 7) {
    const r = parseInt(accentHex.slice(1, 3), 16)
    const g = parseInt(accentHex.slice(3, 5), 16)
    const b = parseInt(accentHex.slice(5, 7), 16)
    root.style.setProperty('--neon-glow', `0 0 8px rgba(${r}, ${g}, ${b}, 0.15)`)
    root.style.setProperty('--color-accent-focus', `rgba(${r}, ${g}, ${b}, 0.3)`)
    root.style.setProperty('--color-accent-subtle', `rgba(${r}, ${g}, ${b}, 0.15)`)
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const resolved = useResolvedTheme()
  const accentColor = useSettingsStore((s) => s.accentColor)
  const env = useSettingsStore((s) => s.env)

  const accentHex = ACCENT_COLORS[accentColor].value

  useLayoutEffect(() => {
    applyEnvCssVars(resolved, env)
  }, [resolved, env])

  useLayoutEffect(() => {
    applyAccentCssVars(accentHex)
  }, [accentHex])

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
        sidebarFontSize: env.sidebarFontSize,
        resolvedTheme: resolved
      }
    }),
    [env, resolved]
  )

  return <ThemeContext.Provider value={ctx}>{children}</ThemeContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeContextType {
  return useContext(ThemeContext)
}

// eslint-disable-next-line react-refresh/only-export-components
export function useEnv(): EnvContext {
  return useContext(ThemeContext).env
}
