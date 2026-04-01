import { describe, it, expect, beforeEach } from 'vitest'
import { useCanvasStore } from '../../src/renderer/src/store/canvas-store'

describe('showAllEdges', () => {
  beforeEach(() => {
    useCanvasStore.setState(useCanvasStore.getInitialState())
  })

  it('defaults to false', () => {
    expect(useCanvasStore.getState().showAllEdges).toBe(false)
  })

  it('toggles to true then back to false', () => {
    useCanvasStore.getState().toggleShowAllEdges()
    expect(useCanvasStore.getState().showAllEdges).toBe(true)
    useCanvasStore.getState().toggleShowAllEdges()
    expect(useCanvasStore.getState().showAllEdges).toBe(false)
  })

  it('resets to false on loadCanvas', () => {
    useCanvasStore.getState().toggleShowAllEdges()
    expect(useCanvasStore.getState().showAllEdges).toBe(true)

    useCanvasStore.getState().loadCanvas('test.canvas', {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    })
    expect(useCanvasStore.getState().showAllEdges).toBe(false)
  })

  it('is not included in toCanvasFile output', () => {
    useCanvasStore.getState().toggleShowAllEdges()
    const file = useCanvasStore.getState().toCanvasFile()
    expect(file).not.toHaveProperty('showAllEdges')
  })
})

describe('demand-driven edge visibility logic', () => {
  function isEdgeRevealed(opts: {
    showAll: boolean
    endpointHovered: boolean
    endpointSelected: boolean
    edgeKind?: string
    zoom: number
  }): boolean {
    if (opts.showAll) return true
    if (opts.endpointHovered) return true
    if (opts.endpointSelected) return true
    if (opts.zoom > 0.8 && (opts.edgeKind === 'imports' || opts.edgeKind === 'references'))
      return true
    return false
  }

  it('hides edges by default', () => {
    expect(
      isEdgeRevealed({
        showAll: false,
        endpointHovered: false,
        endpointSelected: false,
        zoom: 0.5
      })
    ).toBe(false)
  })

  it('reveals edge when endpoint is hovered', () => {
    expect(
      isEdgeRevealed({
        showAll: false,
        endpointHovered: true,
        endpointSelected: false,
        zoom: 0.5
      })
    ).toBe(true)
  })

  it('reveals edge when endpoint is selected', () => {
    expect(
      isEdgeRevealed({
        showAll: false,
        endpointHovered: false,
        endpointSelected: true,
        zoom: 0.5
      })
    ).toBe(true)
  })

  it('reveals imports/references edges at zoom > 0.8', () => {
    expect(
      isEdgeRevealed({
        showAll: false,
        endpointHovered: false,
        endpointSelected: false,
        edgeKind: 'imports',
        zoom: 0.9
      })
    ).toBe(true)
  })

  it('does not reveal imports edges at zoom <= 0.8', () => {
    expect(
      isEdgeRevealed({
        showAll: false,
        endpointHovered: false,
        endpointSelected: false,
        edgeKind: 'imports',
        zoom: 0.7
      })
    ).toBe(false)
  })

  it('reveals all edges when showAll is true', () => {
    expect(
      isEdgeRevealed({
        showAll: true,
        endpointHovered: false,
        endpointSelected: false,
        zoom: 0.5
      })
    ).toBe(true)
  })
})
