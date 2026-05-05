import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { applyAccentCssVars, isValidAccentHex } from '../../src/renderer/src/design/apply-accent'
import { ACCENT_HEX, computeAccentVariants } from '../../src/renderer/src/design/themes'
import {
  ACCENT_PRESETS,
  DEFAULT_ACCENT_ID,
  isAccentId
} from '../../src/renderer/src/design/accent-presets'

const ACCENT_VARS = [
  '--color-accent-default',
  '--color-accent-hover',
  '--color-accent-muted',
  '--neon-glow',
  '--color-accent-focus',
  '--color-accent-subtle',
  '--color-accent-soft',
  '--color-accent-line'
] as const

describe('isValidAccentHex', () => {
  it('accepts a 6-digit hex with leading #', () => {
    expect(isValidAccentHex('#41e0d4')).toBe(true)
    expect(isValidAccentHex('#FFFFFF')).toBe(true)
    expect(isValidAccentHex('#000000')).toBe(true)
  })

  it('rejects strings missing #, wrong length, or non-hex chars', () => {
    expect(isValidAccentHex('41e0d4')).toBe(false)
    expect(isValidAccentHex('#41e0d')).toBe(false)
    expect(isValidAccentHex('#41e0d44')).toBe(false)
    expect(isValidAccentHex('#xyz')).toBe(false)
    expect(isValidAccentHex('#zzzzzz')).toBe(false)
    expect(isValidAccentHex('xyz')).toBe(false)
    expect(isValidAccentHex('')).toBe(false)
  })
})

describe('computeAccentVariants', () => {
  it('keeps default identical to input hex', () => {
    expect(computeAccentVariants('#41e0d4').default).toBe('#41e0d4')
  })

  it('produces a lighter hover variant (each channel ≥ input)', () => {
    const { hover } = computeAccentVariants('#102030')
    expect(hover).toMatch(/^#[0-9a-f]{6}$/)
    const [hr, hg, hb] = [
      parseInt(hover.slice(1, 3), 16),
      parseInt(hover.slice(3, 5), 16),
      parseInt(hover.slice(5, 7), 16)
    ]
    expect(hr).toBeGreaterThanOrEqual(0x10)
    expect(hg).toBeGreaterThanOrEqual(0x20)
    expect(hb).toBeGreaterThanOrEqual(0x30)
  })

  it('emits a color-mix muted token referencing the input', () => {
    expect(computeAccentVariants('#abcdef').muted).toBe(
      'color-mix(in srgb, #abcdef 10%, transparent)'
    )
  })
})

describe('applyAccentCssVars', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style')
  })

  afterEach(() => {
    document.documentElement.removeAttribute('style')
  })

  it('writes every accent CSS var with a non-empty value for a valid hex', () => {
    applyAccentCssVars('#41e0d4')
    const style = document.documentElement.style
    for (const v of ACCENT_VARS) {
      expect(style.getPropertyValue(v)).not.toBe('')
    }
  })

  it('encodes the input hex as rgba components in derived alpha vars', () => {
    applyAccentCssVars('#41e0d4')
    const style = document.documentElement.style
    expect(style.getPropertyValue('--color-accent-default')).toBe('#41e0d4')
    expect(style.getPropertyValue('--color-accent-focus')).toBe('rgba(65, 224, 212, 0.3)')
    expect(style.getPropertyValue('--color-accent-subtle')).toBe('rgba(65, 224, 212, 0.15)')
    expect(style.getPropertyValue('--color-accent-soft')).toBe('rgba(65, 224, 212, 0.16)')
    expect(style.getPropertyValue('--color-accent-line')).toBe('rgba(65, 224, 212, 0.5)')
    expect(style.getPropertyValue('--neon-glow')).toBe('0 0 8px rgba(65, 224, 212, 0.15)')
  })

  it('never emits NaN-laced rgba values for invalid input (falls back to default)', () => {
    applyAccentCssVars('xyz')
    const style = document.documentElement.style
    for (const v of ACCENT_VARS) {
      const val = style.getPropertyValue(v)
      expect(val).not.toContain('NaN')
      expect(val).not.toBe('')
    }
    expect(style.getPropertyValue('--color-accent-default')).toBe(ACCENT_HEX)
  })

  it('falls back when the input is a partial hex from in-progress typing', () => {
    applyAccentCssVars('#ff8c5')
    expect(document.documentElement.style.getPropertyValue('--color-accent-default')).toBe(
      ACCENT_HEX
    )
  })

  it('applies cleanly for every preset in ACCENT_PRESETS', () => {
    for (const preset of ACCENT_PRESETS) {
      applyAccentCssVars(preset.hex)
      const def = document.documentElement.style.getPropertyValue('--color-accent-default')
      expect(def).toBe(preset.hex)
      const focus = document.documentElement.style.getPropertyValue('--color-accent-focus')
      expect(focus).not.toContain('NaN')
    }
  })
})

describe('isAccentId', () => {
  it('accepts every preset id and "custom"', () => {
    for (const preset of ACCENT_PRESETS) {
      expect(isAccentId(preset.id)).toBe(true)
    }
    expect(isAccentId('custom')).toBe(true)
  })

  it('rejects unknown strings, empty values, and non-strings', () => {
    expect(isAccentId('not-a-preset')).toBe(false)
    expect(isAccentId('')).toBe(false)
    expect(isAccentId(null)).toBe(false)
    expect(isAccentId(undefined)).toBe(false)
    expect(isAccentId(42)).toBe(false)
  })

  it('matches DEFAULT_ACCENT_ID', () => {
    expect(isAccentId(DEFAULT_ACCENT_ID)).toBe(true)
  })
})
