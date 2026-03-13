import { describe, it, expect } from 'vitest'
import { colors, ARTIFACT_COLORS } from '../../src/renderer/src/design/tokens'

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
