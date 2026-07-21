import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DEFAULT_CANVAS_ID, getCanvasStore } from '../canvas-store'

const store = getCanvasStore(DEFAULT_CANVAS_ID)

beforeEach(() => {
  store.setState(store.getInitialState())
  vi.useFakeTimers()
})

describe('canvas-store pin pulse', () => {
  it('starts with no recently-pinned nodes', () => {
    expect(store.getState().recentlyPinnedNodeIds.size).toBe(0)
  })

  it('markRecentlyPinned adds node id and clears it after the animation window', () => {
    store.getState().markRecentlyPinned('node-1')
    expect(store.getState().recentlyPinnedNodeIds.has('node-1')).toBe(true)

    vi.advanceTimersByTime(1500)
    expect(store.getState().recentlyPinnedNodeIds.has('node-1')).toBe(false)
  })

  it('handles concurrent pins independently', () => {
    store.getState().markRecentlyPinned('a')
    vi.advanceTimersByTime(800)
    store.getState().markRecentlyPinned('b')

    expect(store.getState().recentlyPinnedNodeIds.has('a')).toBe(true)
    expect(store.getState().recentlyPinnedNodeIds.has('b')).toBe(true)

    vi.advanceTimersByTime(700)
    expect(store.getState().recentlyPinnedNodeIds.has('a')).toBe(false)
    expect(store.getState().recentlyPinnedNodeIds.has('b')).toBe(true)

    vi.advanceTimersByTime(800)
    expect(store.getState().recentlyPinnedNodeIds.has('b')).toBe(false)
  })

  it('clears pulse set on loadCanvas', () => {
    store.getState().markRecentlyPinned('x')
    expect(store.getState().recentlyPinnedNodeIds.size).toBe(1)
    store.getState().loadCanvas('/v/.machina/canvas.json', {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      focusFrames: {}
    })
    expect(store.getState().recentlyPinnedNodeIds.size).toBe(0)
  })
})
