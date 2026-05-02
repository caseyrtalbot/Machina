import { ACCENT_HEX, computeAccentVariants } from './themes'

/** Apply a hex accent across all derived CSS vars. Pass `ACCENT_HEX` for the
 * default Console palette; pass any preset / custom hex to retint the app at
 * runtime (settings will eventually call this). */
export function applyAccentCssVars(hex: string = ACCENT_HEX): void {
  const root = document.documentElement
  const accent = computeAccentVariants(hex)
  root.style.setProperty('--color-accent-default', accent.default)
  root.style.setProperty('--color-accent-hover', accent.hover)
  root.style.setProperty('--color-accent-muted', accent.muted)

  const [r, g, b] = [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ]
  root.style.setProperty('--neon-glow', `0 0 8px rgba(${r}, ${g}, ${b}, 0.15)`)
  root.style.setProperty('--color-accent-focus', `rgba(${r}, ${g}, ${b}, 0.3)`)
  root.style.setProperty('--color-accent-subtle', `rgba(${r}, ${g}, ${b}, 0.15)`)
  root.style.setProperty('--color-accent-soft', `rgba(${r}, ${g}, ${b}, 0.14)`)
  root.style.setProperty('--color-accent-line', `rgba(${r}, ${g}, ${b}, 0.45)`)
}
