import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'

type Listener = (e: MediaQueryListEvent) => void

interface FakeMediaQueryList {
  matches: boolean
  media: string
  addEventListener: (type: 'change', listener: Listener) => void
  removeEventListener: (type: 'change', listener: Listener) => void
  dispatch: (matches: boolean) => void
  addListenerCalls: number
  removeListenerCalls: number
}

function createFakeMql(initial: boolean): FakeMediaQueryList {
  const listeners = new Set<Listener>()
  const mql: FakeMediaQueryList = {
    matches: initial,
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: (_type, listener) => {
      listeners.add(listener)
      mql.addListenerCalls += 1
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener)
      mql.removeListenerCalls += 1
    },
    dispatch: (matches) => {
      mql.matches = matches
      const evt = { matches, media: mql.media } as MediaQueryListEvent
      for (const l of listeners) l(evt)
    },
    addListenerCalls: 0,
    removeListenerCalls: 0
  }
  return mql
}

describe('useReducedMotion', () => {
  let fakeMql: FakeMediaQueryList
  let originalMatchMedia: typeof window.matchMedia

  beforeEach(() => {
    originalMatchMedia = window.matchMedia
    fakeMql = createFakeMql(false)
    window.matchMedia = vi.fn(() => fakeMql as unknown as MediaQueryList)
  })

  afterEach(() => {
    cleanup()
    window.matchMedia = originalMatchMedia
  })

  it('reads initial state from matchMedia', async () => {
    fakeMql = createFakeMql(true)
    window.matchMedia = vi.fn(() => fakeMql as unknown as MediaQueryList)

    const { useReducedMotion } = await import('../useReducedMotion')
    const { result } = renderHook(() => useReducedMotion())

    expect(result.current).toBe(true)
  })

  it('returns false when reduce is not set', async () => {
    const { useReducedMotion } = await import('../useReducedMotion')
    const { result } = renderHook(() => useReducedMotion())

    expect(result.current).toBe(false)
  })

  it('updates when the media query change event fires', async () => {
    const { useReducedMotion } = await import('../useReducedMotion')
    const { result } = renderHook(() => useReducedMotion())

    expect(result.current).toBe(false)

    act(() => {
      fakeMql.dispatch(true)
    })
    expect(result.current).toBe(true)

    act(() => {
      fakeMql.dispatch(false)
    })
    expect(result.current).toBe(false)
  })

  it('removes its change listener on unmount', async () => {
    const { useReducedMotion } = await import('../useReducedMotion')
    const { unmount } = renderHook(() => useReducedMotion())

    expect(fakeMql.addListenerCalls).toBe(1)
    expect(fakeMql.removeListenerCalls).toBe(0)

    unmount()

    expect(fakeMql.removeListenerCalls).toBe(1)
  })
})
