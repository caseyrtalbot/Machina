import { describe, it, expect } from 'vitest'
import {
  colors,
  ARTIFACT_COLORS,
  typeScale,
  borderRadius,
  transitions,
  animations
} from '../../src/renderer/src/design/tokens'

describe('design tokens', () => {
  it('has all background layers', () => {
    expect(colors.bg.base).toBe('#0A0A0B')
    expect(colors.bg.surface).toBe('#111113')
    expect(colors.bg.elevated).toBe('#1A1A1D')
    expect(colors.border.default).toBe('#2A2A2E')
  })

  it('has artifact type colors for all types', () => {
    expect(ARTIFACT_COLORS.gene).toBe('#6C63FF')
    expect(ARTIFACT_COLORS.constraint).toBe('#EF4444')
    expect(ARTIFACT_COLORS.research).toBe('#2DD4BF')
    expect(ARTIFACT_COLORS.output).toBe('#EC4899')
    expect(ARTIFACT_COLORS.note).toBe('#8B8B8E')
    expect(ARTIFACT_COLORS.index).toBe('#38BDF8')
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
    expect(borderRadius.round).toBe('50%')
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
    expect(animations.graphNodeHoverGlow).toBe('200ms ease-out')
    expect(animations.graphNetworkReveal).toBe('200ms ease-out')
    expect(animations.graphNetworkDim).toBe('300ms ease-out')
    expect(animations.graphNodeEnter).toBe('400ms ease-out')
    expect(animations.graphNodeExit).toBe('200ms ease-out')
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
