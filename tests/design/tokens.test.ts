import { describe, it, expect } from 'vitest'
import {
  colors,
  ARTIFACT_COLORS,
  EDGE_KIND_COLORS,
  getArtifactColor,
  typeScale,
  borderRadius,
  transitions,
  animations,
  visualLanguage
} from '../../src/renderer/src/design/tokens'

describe('design tokens', () => {
  it('has all background layers as CSS variable references', () => {
    expect(colors.bg.base).toBe('var(--color-bg-base)')
    expect(colors.bg.surface).toBe('var(--color-bg-surface)')
    expect(colors.bg.elevated).toBe('var(--color-bg-elevated)')
    expect(colors.border.default).toBe('var(--color-border-default)')
    expect(colors.border.subtle).toBe('var(--border-subtle)')
  })

  it('has artifact type colors for all types', () => {
    expect(ARTIFACT_COLORS.gene).toBe('#00cca8')
    expect(ARTIFACT_COLORS.constraint).toBe('#ff847d')
    expect(ARTIFACT_COLORS.research).toBe('#ad9cff')
    expect(ARTIFACT_COLORS.output).toBe('#ec86cc')
    expect(ARTIFACT_COLORS.note).toBe('#a3afc1')
    expect(ARTIFACT_COLORS.index).toBe('#00befa')
  })

  it('has no color collisions between artifact types and semantic colors', () => {
    const semanticColors = [colors.semantic.cluster, colors.semantic.tension]
    const artifactColorValues = Object.values(ARTIFACT_COLORS)
    for (const sc of semanticColors) {
      expect(artifactColorValues).not.toContain(sc)
    }
  })
})

describe('extended design tokens', () => {
  it('has complete type scale with all roles', () => {
    expect(typeScale.display.pageTitle.size).toBe('20px')
    expect(typeScale.display.pageTitle.weight).toBe(600)
    expect(typeScale.display.sectionHeading.size).toBe('15px')
    expect(typeScale.display.body.size).toBe('13px')
    expect(typeScale.display.secondary.size).toBe('12px')
    expect(typeScale.display.label.size).toBe('12px')
    expect(typeScale.display.label.textTransform).toBe('uppercase')
    expect(typeScale.display.label.letterSpacing).toBe('0.05em')
    expect(typeScale.mono.terminal.size).toBe('13px')
    expect(typeScale.mono.source.size).toBe('12px')
    expect(typeScale.mono.inline.size).toBe('12px')
  })

  it('has border-radius constants', () => {
    expect(borderRadius.container).toBe(6)
    expect(borderRadius.inline).toBe(4)
    expect(borderRadius.card).toBe(0)
    expect(borderRadius.round).toBe('50%')
  })

  it('has visual language tokens', () => {
    expect(visualLanguage.panelGap).toBe(0)
    expect(visualLanguage.cardRadius).toBe(0)
    expect(visualLanguage.borderSubtle).toBe('color-mix(in srgb, white 8%, transparent)')
  })

  it('has transition timing constants', () => {
    expect(transitions.hover).toBe('150ms ease-out')
    expect(transitions.tooltip).toBe('100ms ease-in')
    expect(transitions.focusRing).toBe('100ms ease-out')
    expect(transitions.settingsSlide).toBe('250ms ease-out')
    expect(transitions.modalFade).toBe('200ms ease-in')
    expect(transitions.commandPalette).toBe('150ms ease-out')
  })

  it('has animation timing constants', () => {
    expect(animations.spatialTransition).toBe('250ms ease-out')
  })

  it('enforces max animation duration of 400ms', () => {
    const allDurations = [...Object.values(transitions), ...Object.values(animations)]
    for (const timing of allDurations) {
      const ms = parseInt(timing, 10)
      expect(ms).toBeLessThanOrEqual(400)
    }
  })
})

describe('getArtifactColor', () => {
  it('returns distinct colors for different custom types', () => {
    const patternColor = getArtifactColor('pattern')
    const doctrineColor = getArtifactColor('doctrine')
    const theoryColor = getArtifactColor('theory')

    const uniqueColors = new Set([patternColor, doctrineColor, theoryColor])
    expect(uniqueColors.size).toBeGreaterThanOrEqual(2)
  })

  it('returns consistent color for the same custom type', () => {
    expect(getArtifactColor('pattern')).toBe(getArtifactColor('pattern'))
  })

  it('still returns built-in colors for known types', () => {
    expect(getArtifactColor('gene')).toBe('#00cca8')
    expect(getArtifactColor('constraint')).toBe('#ff847d')
  })

  it('custom type colors do not collide with built-in colors', () => {
    const builtInColors = new Set(Object.values(ARTIFACT_COLORS))
    const customColor = getArtifactColor('myCustomType')
    expect(builtInColors.has(customColor)).toBe(false)
  })
})

describe('EDGE_KIND_COLORS', () => {
  it('has colors for contains, imports, and references edge kinds', () => {
    expect(EDGE_KIND_COLORS.contains).toBe('#4e5661')
    expect(EDGE_KIND_COLORS.imports).toBe('#5b8dd9')
    expect(EDGE_KIND_COLORS.references).toBe('#9887e8')
  })

  it('retains existing edge kind colors unchanged', () => {
    expect(EDGE_KIND_COLORS.connection).toBe('#667383')
    expect(EDGE_KIND_COLORS.cluster).toBe('#3dca8d')
    expect(EDGE_KIND_COLORS.tension).toBe('#ecaa0b')
    expect(EDGE_KIND_COLORS.related).toBe('#9887e8')
    expect(EDGE_KIND_COLORS['co-occurrence']).toBe('#4e5661')
    expect(EDGE_KIND_COLORS.appears_in).toBe('#667383')
    expect(EDGE_KIND_COLORS.causal).toBe('#da76bb')
  })
})
