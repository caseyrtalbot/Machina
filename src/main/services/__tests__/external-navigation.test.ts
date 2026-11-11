import { describe, expect, it, vi } from 'vitest'
import { attachExternalNavigationGuards, isExternalHttpNavigation } from '../external-navigation'

describe('external-navigation', () => {
  it('treats non-http URLs as internal', () => {
    expect(isExternalHttpNavigation('file:///tmp/test.md')).toBe(false)
    expect(isExternalHttpNavigation('about:blank')).toBe(false)
  })

  it('allows renderer dev-origin URLs to stay internal', () => {
    expect(isExternalHttpNavigation('http://localhost:5173/editor', 'http://localhost:5173')).toBe(
      false
    )
  })

  it('opens external URLs from window.open and denies the new window', async () => {
    const openExternal = vi.fn()
    let handler: ((details: { url: string }) => { action: 'deny' }) | null = null

    attachExternalNavigationGuards(
      {
        setWindowOpenHandler: vi.fn((nextHandler) => {
          handler = nextHandler as typeof handler
          return { action: 'deny' }
        }),
        on: vi.fn()
      } as never,
      { openExternal }
    )

    expect(handler).not.toBeNull()
    expect(handler!({ url: 'https://example.com' })).toEqual({ action: 'deny' })

    await Promise.resolve()
    expect(openExternal).toHaveBeenCalledWith('https://example.com')
  })

  it.each([
    'file:///tmp/untrusted.html',
    'data:text/html,<script></script>',
    'javascript:alert(1)',
    'about:blank'
  ])('blocks untrusted navigation to %s without launching it externally', (url) => {
    const openExternal = vi.fn()
    const preventDefault = vi.fn()
    const listeners = new Map<
      string,
      (event: { preventDefault: () => void }, url: string) => void
    >()
    attachExternalNavigationGuards(
      {
        setWindowOpenHandler: vi.fn(),
        on: vi.fn((event, listener) => listeners.set(event, listener))
      } as never,
      { openExternal }
    )
    listeners.get('will-navigate')!({ preventDefault }, url)
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('prevents external navigation on will-navigate', async () => {
    const openExternal = vi.fn()
    const preventDefault = vi.fn()
    let willNavigate: ((event: { preventDefault: () => void }, url: string) => void) | null = null

    attachExternalNavigationGuards(
      {
        setWindowOpenHandler: vi.fn(),
        on: vi.fn((event, listener) => {
          if (event === 'will-navigate') {
            willNavigate = listener as typeof willNavigate
          }
        })
      } as never,
      { openExternal }
    )

    expect(willNavigate).not.toBeNull()
    willNavigate!({ preventDefault }, 'https://example.com')

    await Promise.resolve()
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(openExternal).toHaveBeenCalledWith('https://example.com')
  })
})
