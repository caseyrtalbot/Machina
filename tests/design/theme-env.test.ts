import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { createElement } from 'react'
import { ThemeProvider } from '../../src/renderer/src/design/Theme'

function stubMatchMedia(matches = false): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }))
  )
}

describe('ThemeProvider design constants', () => {
  beforeEach(() => {
    stubMatchMedia(false)
    document.documentElement.removeAttribute('style')
  })

  afterEach(() => {
    cleanup()
    document.documentElement.removeAttribute('style')
  })

  it('applies the fixed design-constant CSS vars on mount', () => {
    render(createElement(ThemeProvider, null, createElement('div', null, 'themed')))

    const rootStyle = document.documentElement.style
    expect(rootStyle.getPropertyValue('--color-bg-base')).toBe('#000000')
    expect(rootStyle.getPropertyValue('--env-sidebar-font-size')).toBe('13px')
    expect(rootStyle.getPropertyValue('--env-card-blur')).toBe('9px')
    expect(rootStyle.getPropertyValue('--r-card')).toBe('0px')
    expect(rootStyle.getPropertyValue('--row-h')).toBe('26px')
    expect(rootStyle.getPropertyValue('--canvas-card-bg')).toBe('rgba(10, 10, 13, 0.94)')
    expect(rootStyle.getPropertyValue('--color-accent-default')).not.toBe('')
  })
})
