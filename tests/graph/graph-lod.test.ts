import { describe, it, expect } from 'vitest'
import {
  getGraphLod,
  shouldShowLabel,
  nodeRadius,
  edgeWidth
} from '@renderer/panels/graph/graph-lod'

describe('graph-lod', () => {
  it('returns macro for very low zoom', () => {
    expect(getGraphLod(0.1)).toBe('macro')
    expect(getGraphLod(0.2)).toBe('macro')
  })

  it('returns meso for medium zoom', () => {
    expect(getGraphLod(0.5)).toBe('meso')
    expect(getGraphLod(0.8)).toBe('meso')
  })

  it('returns micro for high zoom', () => {
    expect(getGraphLod(1.5)).toBe('micro')
    expect(getGraphLod(3.0)).toBe('micro')
  })

  it('never shows labels at macro', () => {
    expect(shouldShowLabel('macro', 10)).toBe(false)
    expect(shouldShowLabel('macro', 100)).toBe(false)
  })

  it('shows labels for high-connection nodes at meso', () => {
    expect(shouldShowLabel('meso', 8)).toBe(true)
    expect(shouldShowLabel('meso', 1)).toBe(false)
  })

  it('shows all labels at micro', () => {
    expect(shouldShowLabel('micro', 0)).toBe(true)
    expect(shouldShowLabel('micro', 1)).toBe(true)
  })

  it('scales node radius by connection count', () => {
    const small = nodeRadius(0)
    const large = nodeRadius(20)
    expect(large).toBeGreaterThan(small)
    expect(small).toBeGreaterThanOrEqual(4)
    expect(large).toBeLessThanOrEqual(24)
  })

  it('scales edge width by zoom', () => {
    const thin = edgeWidth(0.3)
    const thick = edgeWidth(2.0)
    expect(thick).toBeGreaterThanOrEqual(thin)
  })
})
