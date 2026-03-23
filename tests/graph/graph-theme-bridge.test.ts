import { describe, it, expect } from 'vitest'
import { hexToPixi, buildEdgeColor } from '@renderer/panels/graph/graph-theme-bridge'
import { EDGE_KIND_COLORS } from '@renderer/design/tokens'

describe('graph-theme-bridge', () => {
  describe('hexToPixi', () => {
    it('converts #ffffff to 0xffffff', () => {
      expect(hexToPixi('#ffffff')).toBe(0xffffff)
    })

    it('converts #000000 to 0x000000', () => {
      expect(hexToPixi('#000000')).toBe(0x000000)
    })

    it('converts #00cca8 to correct value', () => {
      expect(hexToPixi('#00cca8')).toBe(0x00cca8)
    })

    it('handles 3-digit hex', () => {
      expect(hexToPixi('#fff')).toBe(0xffffff)
    })
  })

  describe('buildEdgeColor', () => {
    it('returns cluster color for cluster kind', () => {
      const c = buildEdgeColor('cluster')
      expect(typeof c).toBe('number')
    })

    it('returns tension color for tension kind', () => {
      const c = buildEdgeColor('tension')
      expect(typeof c).toBe('number')
    })

    it('returns default color for connection kind', () => {
      const c = buildEdgeColor('connection')
      expect(typeof c).toBe('number')
    })

    it('derives colors from EDGE_KIND_COLORS tokens', () => {
      expect(buildEdgeColor('cluster')).toBe(hexToPixi(EDGE_KIND_COLORS.cluster))
      expect(buildEdgeColor('tension')).toBe(hexToPixi(EDGE_KIND_COLORS.tension))
      expect(buildEdgeColor('connection')).toBe(hexToPixi(EDGE_KIND_COLORS.connection))
      expect(buildEdgeColor('related')).toBe(hexToPixi(EDGE_KIND_COLORS.related))
    })
  })
})
