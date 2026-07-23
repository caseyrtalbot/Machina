import { createContext, useLayoutEffect, type ReactNode } from 'react'
import { spacing, typography, transitions, floatingPanel } from './tokens'
import {
  STRUCTURAL_COLORS,
  CHROME_BG_HEX,
  LINE_ALPHAS,
  SIGNAL_COLORS,
  BACKGROUND,
  DENSITY_DEFAULT_VARS,
  RADII_SQUARE_VARS,
  CARD_BLUR_PX,
  CARD_TITLE_FONT_SIZE_PX,
  CARD_BODY_FONT_SIZE_PX,
  SIDEBAR_FONT_SIZE_PX,
  CARD_OPACITY,
  CARD_HEADER_DARKNESS
} from './themes'
import { applyAccentCssVars } from './apply-accent'

interface ThemeContextType {
  spacing: typeof spacing
  typography: typeof typography
  transitions: typeof transitions
}

const THEME_CONTEXT_VALUE: ThemeContextType = { spacing, typography, transitions }

const ThemeContext = createContext<ThemeContextType>(THEME_CONTEXT_VALUE)

function applyDesignConstants(): void {
  const root = document.documentElement
  const structural = STRUCTURAL_COLORS
  const bg = BACKGROUND

  // ── Background ramp (fixed pure-black constants) ──
  const parseHex = (hex: string): [number, number, number] => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ]
  const [r, g, b] = parseHex(bg.base)
  root.style.setProperty('--canvas-surface-bg', `rgb(${r}, ${g}, ${b})`)

  const cardOp = CARD_OPACITY / 100
  const [cr, cg, cb] = parseHex(bg.card)
  root.style.setProperty('--canvas-card-bg', `rgba(${cr}, ${cg}, ${cb}, ${cardOp})`)
  root.style.setProperty('--canvas-card-title-bg', `rgba(0, 0, 0, ${CARD_HEADER_DARKNESS / 100})`)

  root.style.setProperty('--color-bg-base', bg.base)
  root.style.setProperty('--color-bg-surface', bg.surface)
  root.style.setProperty('--color-bg-elevated', bg.elevated)
  root.style.setProperty('--color-bg-chrome', bg.chrome)
  root.style.setProperty('--color-bg-rail', bg.rail)
  root.style.setProperty('--bg-card', bg.card)
  root.style.setProperty('--bg-card-hover', bg.cardHover)

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

  // ── Density / radii (fixed constants) ──
  for (const [key, value] of Object.entries(DENSITY_DEFAULT_VARS)) {
    root.style.setProperty(key, value)
  }
  for (const [key, value] of Object.entries(RADII_SQUARE_VARS)) {
    root.style.setProperty(key, value)
  }
  root.style.setProperty('--r-pill', '999px')

  // ── Fixed font sizes / blur ──
  root.style.setProperty('--env-card-blur', `${CARD_BLUR_PX}px`)
  root.style.setProperty('--env-card-title-font-size', `${CARD_TITLE_FONT_SIZE_PX}px`)
  root.style.setProperty('--env-card-body-font-size', `${CARD_BODY_FONT_SIZE_PX}px`)
  root.style.setProperty(
    '--env-card-code-font-size',
    `${Math.max(Math.round(CARD_BODY_FONT_SIZE_PX * 0.75), 10)}px`
  )
  root.style.setProperty('--env-sidebar-font-size', `${SIDEBAR_FONT_SIZE_PX}px`)
  root.style.setProperty(
    '--env-sidebar-secondary-font-size',
    `${Math.max(SIDEBAR_FONT_SIZE_PX - 1, 11)}px`
  )
  root.style.setProperty(
    '--env-sidebar-tertiary-font-size',
    `${Math.max(SIDEBAR_FONT_SIZE_PX - 3, 10)}px`
  )

  // ── Motion + elevation catalog (static; from tokens) ──
  root.style.setProperty('--t-micro', transitions.micro)
  root.style.setProperty('--t-fast', transitions.fast)
  root.style.setProperty('--t-med', transitions.med)
  root.style.setProperty('--t-slow', transitions.slow)
  root.style.setProperty('--t-surface', transitions.surface)
  root.style.setProperty('--shadow-floating', floatingPanel.shadow)
  root.style.setProperty('--shadow-compact', floatingPanel.shadowCompact)
  root.style.setProperty('--shadow-card', floatingPanel.shadowCard)
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    applyDesignConstants()
    applyAccentCssVars()
  }, [])

  return <ThemeContext.Provider value={THEME_CONTEXT_VALUE}>{children}</ThemeContext.Provider>
}
