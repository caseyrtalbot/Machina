import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useCanvasStore } from '../canvas-store'

beforeEach(() => {
  useCanvasStore.setState(useCanvasStore.getInitialState())
  vi.useFakeTimers()
})

describe('canvas-store pin pulse', () => {
  it('starts with no recently-pinned nodes', () => {
    expect(useCanvasStore.getState().recentlyPinnedNodeIds.size).toBe(0)
  })

  it('markRecentlyPinned adds node id and clears it after the animation window', () => {
    useCanvasStore.getState().markRecentlyPinned('node-1')
    expect(useCanvasStore.getState().recentlyPinnedNodeIds.has('node-1')).toBe(true)

    vi.advanceTimersByTime(1500)
    expect(useCanvasStore.getState().recentlyPinnedNodeIds.has('node-1')).toBe(false)
  })

  it('handles concurrent pins independently', () => {
    useCanvasStore.getState().markRecentlyPinned('a')
    vi.advanceTimersByTime(800)
    useCanvasStore.getState().markRecentlyPinned('b')

    expect(useCanvasStore.getState().recentlyPinnedNodeIds.has('a')).toBe(true)
    expect(useCanvasStore.getState().recentlyPinnedNodeIds.has('b')).toBe(true)

    vi.advanceTimersByTime(700)
    expect(useCanvasStore.getState().recentlyPinnedNodeIds.has('a')).toBe(false)
    expect(useCanvasStore.getState().recentlyPinnedNodeIds.has('b')).toBe(true)

    vi.advanceTimersByTime(800)
    expect(useCanvasStore.getState().recentlyPinnedNodeIds.has('b')).toBe(false)
  })

  it('clears pulse set on loadCanvas', () => {
    useCanvasStore.getState().markRecentlyPinned('x')
    expect(useCanvasStore.getState().recentlyPinnedNodeIds.size).toBe(1)
    useCanvasStore.getState().loadCanvas('/v/.machina/canvas.json', {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      focusFrames: {}
    })
    expect(useCanvasStore.getState().recentlyPinnedNodeIds.size).toBe(0)
  })
})
