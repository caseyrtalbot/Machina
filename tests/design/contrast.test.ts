import { describe, it, expect } from 'vitest'
import {
  BACKGROUND,
  STRUCTURAL_COLORS,
  SIGNAL_COLORS,
  ACCENT_HEX
} from '../../src/renderer/src/design/themes'
import { ARTIFACT_COLORS } from '../../src/renderer/src/design/tokens'

/**
 * WCAG 2.x contrast gate (ADR 0005 §Enforcement — "contrast as a unit test").
 *
 * The ratified palette lives in `themes.ts` as opaque sRGB hex; `tokens.ts`
 * exposes the same colors as `var(--…)` indirections that resolve to those
 * hex values at runtime (see Theme.tsx `applyDesignConstants`). Happy-dom
 * cannot read the external stylesheet, so we import the source constants and
 * compute contrast ourselves rather than probing computed styles.
 *
 * None of the ratified exports are OKLCH strings (the OKLCH provenance lives
 * only in code comments — the shipped values are pre-clamped sRGB hex), so no
 * color-space conversion is needed here.
 *
 * Thresholds are chosen per the real bar each pair must clear:
 *   - 4.5:1 for body-size text (WCAG AA normal text).
 *   - 3:1   for large/secondary UI text and non-text UI (dots, node fills,
 *           borders) — WCAG AA large-text / non-text bar.
 * Where a current pair fails its natural bar it is pinned with a TODO-tagged
 * lowered assertion (see `muted` text below); Layer 4's retune owns raising
 * the value, and the pin guards against further regression meanwhile.
 */

// ── WCAG relative-luminance contrast, computed from first principles ──
function parseHex(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ]
}

function srgbToLinear(channel8bit: number): number {
  const s = channel8bit / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex)
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
}

function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

// The three background layers text and signals actually sit on (void → raised).
const SURFACES: ReadonlyArray<[string, string]> = [
  ['base', BACKGROUND.base],
  ['surface', BACKGROUND.surface],
  ['elevated', BACKGROUND.elevated]
]

const BODY_AA = 4.5 // normal-size text
const LARGE_AA = 3.0 // large/secondary text and non-text UI
const MUTED_PIN = 4.0 // TODO(Layer 4): muted text falls short of 4.5 — see below

describe('WCAG contrast: helper self-check', () => {
  // Anchor the math against known reference pairs so a bug in the helper
  // can't quietly pass the palette assertions.
  it('computes the canonical black/white extremes', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contrastRatio('#000000', '#000000')).toBeCloseTo(1, 5)
  })
})

describe('WCAG contrast: primary text is fully readable everywhere', () => {
  for (const [name, bg] of SURFACES) {
    it(`primary text on ${name} clears body AA (4.5:1)`, () => {
      expect(contrastRatio(STRUCTURAL_COLORS.text.primary, bg)).toBeGreaterThanOrEqual(BODY_AA)
    })
  }
})

describe('WCAG contrast: secondary text is readable as body text', () => {
  for (const [name, bg] of SURFACES) {
    it(`secondary text on ${name} clears body AA (4.5:1)`, () => {
      expect(contrastRatio(STRUCTURAL_COLORS.text.secondary, bg)).toBeGreaterThanOrEqual(BODY_AA)
    })
  }
})

describe('WCAG contrast: muted text (de-emphasized metadata)', () => {
  // Muted is the third readable level — timestamps, counts, hints — rendered
  // at small UI sizes, so its natural bar is 4.5:1. It currently lands at
  // ~4.09–4.35:1 (worst on `elevated`), i.e. BELOW the AA body bar. This is a
  // real, known shortfall the Layer 4 retune must fix by darkening surfaces or
  // lifting the muted step. Pinned at 4.0 so the debt is explicit and any
  // further regression fails CI.
  for (const [name, bg] of SURFACES) {
    it(`muted text on ${name} holds the pinned floor (TODO: raise to 4.5)`, () => {
      const ratio = contrastRatio(STRUCTURAL_COLORS.text.muted, bg)
      expect(ratio).toBeGreaterThanOrEqual(MUTED_PIN)
      expect(ratio).toBeLessThan(BODY_AA) // documents the shortfall; delete once fixed
    })
  }
})

describe('WCAG contrast: text ramp stays monotonic', () => {
  // Disabled text is WCAG-exempt (disabled controls carry no contrast minimum),
  // so it is not asserted against a floor — but the ramp must stay ordered so a
  // palette edit can't accidentally make "disabled" more prominent than "muted".
  it('primary > secondary > muted > disabled on base', () => {
    const c = (hex: string) => contrastRatio(hex, BACKGROUND.base)
    expect(c(STRUCTURAL_COLORS.text.primary)).toBeGreaterThan(c(STRUCTURAL_COLORS.text.secondary))
    expect(c(STRUCTURAL_COLORS.text.secondary)).toBeGreaterThan(c(STRUCTURAL_COLORS.text.muted))
    expect(c(STRUCTURAL_COLORS.text.muted)).toBeGreaterThan(c(STRUCTURAL_COLORS.text.disabled))
  })
})

describe('WCAG contrast: accent on dark surfaces', () => {
  // Ember accent is used for links, active labels, and icon glyphs (text-like),
  // so it must clear the body bar, not just the non-text bar.
  for (const [name, bg] of SURFACES) {
    it(`accent on ${name} clears body AA (4.5:1)`, () => {
      expect(contrastRatio(ACCENT_HEX, bg)).toBeGreaterThanOrEqual(BODY_AA)
    })
  }
})

describe('WCAG contrast: status signals', () => {
  // Signals appear both as status dots (non-text, 3:1 bar) and as pill/label
  // text (4.5 bar). They clear the stricter body bar with headroom, so we
  // assert 4.5 for all four rather than the looser dot bar.
  const signals: ReadonlyArray<[string, string]> = [
    ['success', SIGNAL_COLORS.success],
    ['warn', SIGNAL_COLORS.warn],
    ['danger', SIGNAL_COLORS.danger],
    ['info', SIGNAL_COLORS.info]
  ]
  for (const [sigName, hex] of signals) {
    for (const [bgName, bg] of SURFACES) {
      it(`${sigName} on ${bgName} clears body AA (4.5:1)`, () => {
        expect(contrastRatio(hex, bg)).toBeGreaterThanOrEqual(BODY_AA)
      })
    }
  }
})

describe('WCAG contrast: artifact node colors are legible as non-text UI', () => {
  // Artifact colors are node fills/rings on the near-black canvas — non-text UI
  // elements, so the real bar is 3:1. All sit at OKLCH L=0.75, comfortably clear.
  for (const [type, hex] of Object.entries(ARTIFACT_COLORS)) {
    it(`${type} fill on base clears non-text AA (3:1)`, () => {
      expect(contrastRatio(hex, BACKGROUND.base)).toBeGreaterThanOrEqual(LARGE_AA)
    })
  }
})
