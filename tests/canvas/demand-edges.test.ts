import { describe, it, expect, beforeEach } from 'vitest'
import { DEFAULT_CANVAS_ID, getCanvasStore } from '../../src/renderer/src/store/canvas-store'

const store = getCanvasStore(DEFAULT_CANVAS_ID)

describe('showAllEdges', () => {
  beforeEach(() => {
    store.setState(store.getInitialState())
  })

  it('defaults to false', () => {
    expect(store.getState().showAllEdges).toBe(false)
  })

  it('toggles to true then back to false', () => {
    store.getState().toggleShowAllEdges()
    expect(store.getState().showAllEdges).toBe(true)
    store.getState().toggleShowAllEdges()
    expect(store.getState().showAllEdges).toBe(false)
  })

  it('defaults to false on loadCanvas when the file has no showAllEdges', () => {
    store.getState().toggleShowAllEdges()
    expect(store.getState().showAllEdges).toBe(true)

    store.getState().loadCanvas('test.canvas', {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    })
    expect(store.getState().showAllEdges).toBe(false)
  })

  it('restores showAllEdges from the loaded file', () => {
    store.getState().loadCanvas('test.canvas', {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      showAllEdges: true
    })
    expect(store.getState().showAllEdges).toBe(true)
  })

  it('is persisted via toCanvasFile', () => {
    store.getState().toggleShowAllEdges()
    const file = store.getState().toCanvasFile()
    expect(file.showAllEdges).toBe(true)
  })

  it('toggling marks the canvas dirty so the toggle persists', () => {
    expect(store.getState().isDirty).toBe(false)
    store.getState().toggleShowAllEdges()
    expect(store.getState().isDirty).toBe(true)
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
