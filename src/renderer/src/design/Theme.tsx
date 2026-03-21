import { createContext, useContext, useLayoutEffect, useMemo, type ReactNode } from 'react'
import { spacing, typography, transitions } from './tokens'
import { resolveColors, type ResolvedColors } from './themes'
import { useSettingsStore } from '../store/settings-store'

interface ThemeContextType {
  colors: ResolvedColors
  spacing: typeof spacing
  typography: typeof typography
  transitions: typeof transitions
}

const defaultColors = resolveColors('midnight', 'matrix')

const ThemeContext = createContext<ThemeContextType>({
  colors: defaultColors,
  spacing,
  typography,
  transitions
})

function applyThemeCssVars(colors: ResolvedColors): void {
  const root = document.documentElement

  root.style.setProperty('--color-bg-base', colors.bg.base)
  root.style.setProperty('--color-bg-surface', colors.bg.surface)
  root.style.setProperty('--color-bg-elevated', colors.bg.elevated)
  root.style.setProperty('--color-border-default', colors.border.default)
  root.style.setProperty('--border-subtle', colors.border.subtle)
  root.style.setProperty('--color-text-primary', colors.text.primary)
  root.style.setProperty('--color-text-secondary', colors.text.secondary)
  root.style.setProperty('--color-text-muted', colors.text.muted)
  root.style.setProperty('--color-accent-default', colors.accent.default)
  root.style.setProperty('--color-accent-hover', colors.accent.hover)
  root.style.setProperty('--color-accent-muted', colors.accent.muted)

  // Canvas-specific tokens
  root.style.setProperty('--canvas-surface-bg', colors.canvas.surface)
  root.style.setProperty('--canvas-card-bg', colors.canvas.card)
  root.style.setProperty('--canvas-card-title-bg', colors.canvas.cardTitleBar)
  root.style.setProperty('--canvas-card-border', colors.canvas.cardBorder)
  root.style.setProperty('--canvas-text-heading', colors.canvas.textHeading)
  root.style.setProperty('--canvas-blockquote-bar', colors.canvas.blockquoteBar)

  const hex = colors.accent.default
  if (hex.startsWith('#') && hex.length === 7) {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    root.style.setProperty('--neon-glow', `0 0 8px rgba(${r}, ${g}, ${b}, 0.15)`)
    root.style.setProperty('--color-accent-focus', `rgba(${r}, ${g}, ${b}, 0.3)`)
    root.style.setProperty('--color-accent-subtle', `rgba(${r}, ${g}, ${b}, 0.15)`)
  }
}

interface ThemeProviderProps {
  children: ReactNode
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const theme = useSettingsStore((s) => s.theme)
  const accentColor = useSettingsStore((s) => s.accentColor)

  const colors = useMemo(() => resolveColors(theme, accentColor), [theme, accentColor])

  useLayoutEffect(() => {
    applyThemeCssVars(colors)
  }, [colors])

  return (
    <ThemeContext.Provider value={{ colors, spacing, typography, transitions }}>
      {children}
    </ThemeContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeContextType {
  return useContext(ThemeContext)
}

// eslint-disable-next-line react-refresh/only-export-components
export function useColors(): ResolvedColors {
  return useContext(ThemeContext).colors
}
