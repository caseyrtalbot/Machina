import { ACCENT_HEX, computeAccentVariants } from './themes'

const HEX_RE = /^#([0-9a-fA-F]{6})$/

export function isValidAccentHex(value: string): boolean {
  return HEX_RE.test(value)
}

/** Apply a hex accent across all derived CSS vars. Pass `ACCENT_HEX` for the
 * default Console palette; pass any preset / custom hex to retint the app at
 * runtime. Invalid hex (e.g. partial typing in the custom input) is rejected
 * here so the live keystroke stream can't strand the app with NaN-laced
 * `rgba()` values across five accent CSS vars. */
/** Darken a hex by `factor` (0..1) toward black — used to derive the
 * pressed-state color when no explicit pressed hex is supplied. */
function darkenHex(hex: string, factor: number): string {
  const n = (i: number): number => parseInt(hex.slice(i, i + 2), 16)
  const r = n(1)
  const g = n(3)
  const b = n(5)
  const dim = (c: number): number => Math.max(0, Math.round(c * (1 - factor)))
  const toHex = (c: number): string => c.toString(16).padStart(2, '0')
  return `#${toHex(dim(r))}${toHex(dim(g))}${toHex(dim(b))}`
}

/** Pick the readable foreground for an accent button. Computes relative
 * luminance and returns near-black for warm/light accents, near-white for
 * cool/dark accents. Tracks the design's `--accent-fg: #1a0f08`. */
function pickAccentFg(hex: string): string {
  const n = (i: number): number => parseInt(hex.slice(i, i + 2), 16) / 255
  const r = n(1)
  const g = n(3)
  const b = n(5)
  // Rec. 709 luminance; threshold tuned so Ember/Signal/Acid/Rose get dark fg.
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum > 0.55 ? '#1a0f08' : '#ffffff'
}

export function applyAccentCssVars(hex: string = ACCENT_HEX): void {
  const safe = isValidAccentHex(hex) ? hex : ACCENT_HEX
  const root = document.documentElement
  const accent = computeAccentVariants(safe)
  root.style.setProperty('--color-accent-default', accent.default)
  root.style.setProperty('--color-accent-hover', accent.hover)
  root.style.setProperty('--color-accent-pressed', darkenHex(safe, 0.12))
  root.style.setProperty('--color-accent-muted', accent.muted)
  root.style.setProperty('--color-accent-fg', pickAccentFg(safe))

  const [r, g, b] = [
    parseInt(safe.slice(1, 3), 16),
    parseInt(safe.slice(3, 5), 16),
    parseInt(safe.slice(5, 7), 16)
  ]
  root.style.setProperty('--neon-glow', `0 0 8px rgba(${r}, ${g}, ${b}, 0.15)`)
  root.style.setProperty('--color-accent-focus', `rgba(${r}, ${g}, ${b}, 0.3)`)
  root.style.setProperty('--color-accent-subtle', `rgba(${r}, ${g}, ${b}, 0.15)`)
  root.style.setProperty('--color-accent-soft', `rgba(${r}, ${g}, ${b}, 0.16)`)
  root.style.setProperty('--color-accent-line', `rgba(${r}, ${g}, ${b}, 0.5)`)
}
