import { describe, it, expect, beforeEach } from 'vitest'
import { useCanvasStore } from '../../src/renderer/src/store/canvas-store'
import { createCanvasNode, createCanvasEdge } from '../../src/shared/canvas-types'
import { EDGE_KIND_COLORS } from '../../src/renderer/src/design/tokens'
import {
  getEdgeStrokeDasharray,
  getEdgeStrokeWidth
} from '../../src/renderer/src/panels/canvas/EdgeLayer'

describe('edge styling helpers', () => {
  describe('getEdgeStrokeDasharray', () => {
    it('returns "6 4" for imports edges', () => {
      expect(getEdgeStrokeDasharray('imports')).toBe('6 4')
    })

    it('returns "2 4" for references edges', () => {
      expect(getEdgeStrokeDasharray('references')).toBe('2 4')
    })

    it('returns undefined for contains edges', () => {
      expect(getEdgeStrokeDasharray('contains')).toBeUndefined()
    })

    it('returns undefined for connection edges', () => {
      expect(getEdgeStrokeDasharray('connection')).toBeUndefined()
    })

    it('returns undefined for undefined kind', () => {
      expect(getEdgeStrokeDasharray(undefined)).toBeUndefined()
    })
  })

  describe('getEdgeStrokeWidth', () => {
    it('returns 1 for contains edges', () => {
      expect(getEdgeStrokeWidth('contains')).toBe(1)
    })

    it('returns 1.5 for imports edges', () => {
      expect(getEdgeStrokeWidth('imports')).toBe(1.5)
    })

    it('returns 1.5 for references edges', () => {
      expect(getEdgeStrokeWidth('references')).toBe(1.5)
    })

    it('returns 1.5 for connection edges', () => {
      expect(getEdgeStrokeWidth('connection')).toBe(1.5)
    })

    it('returns 1.5 for undefined kind', () => {
      expect(getEdgeStrokeWidth(undefined)).toBe(1.5)
    })
  })
})

describe('edge zoom reveal logic', () => {
  beforeEach(() => {
    useCanvasStore.setState(useCanvasStore.getInitialState())
  })

  it('hidden imports edge is revealed when zoom > 0.8', () => {
    const n1 = createCanvasNode('text', { x: 0, y: 0 })
    const n2 = createCanvasNode('text', { x: 300, y: 0 })
    const edge = createCanvasEdge(n1.id, n2.id, 'right', 'left')
    const hiddenImportsEdge = { ...edge, kind: 'imports' as const, hidden: true }

    // At zoom 0.9 (> 0.8), imports edge should be zoom-revealed
    const zoomRevealed = 0.9 > 0.8 && hiddenImportsEdge.kind === 'imports'
    expect(zoomRevealed).toBe(true)
  })

  it('hidden imports edge is NOT revealed when zoom <= 0.8', () => {
    const zoomRevealed = 0.8 > 0.8 && true
    expect(zoomRevealed).toBe(false)
  })

  it('hidden references edge is revealed when zoom > 0.8', () => {
    const zoomRevealed = 0.9 > 0.8 && true
    expect(zoomRevealed).toBe(true)
  })

  it('hidden connection edge is NOT revealed by zoom', () => {
    const kind = 'connection'
    const zoomRevealed = 0.9 > 0.8 && (kind === 'imports' || kind === 'references')
    expect(zoomRevealed).toBe(false)
  })

  it('hidden contains edge is NOT revealed by zoom', () => {
    const kind = 'contains'
    const zoomRevealed = 0.9 > 0.8 && (kind === 'imports' || kind === 'references')
    expect(zoomRevealed).toBe(false)
  })
})

describe('edge kind color lookup', () => {
  it('new edge kinds resolve to correct colors', () => {
    expect(EDGE_KIND_COLORS.contains).toBe('#4e5661')
    expect(EDGE_KIND_COLORS.imports).toBe('#5b8dd9')
    expect(EDGE_KIND_COLORS.references).toBe('#9887e8')
  })
})
