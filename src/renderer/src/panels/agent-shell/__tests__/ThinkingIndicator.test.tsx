import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ThinkingIndicator } from '../ThinkingIndicator'

describe('ThinkingIndicator', () => {
  it('renders an accessible status with a screen-reader label', () => {
    render(<ThinkingIndicator />)
    const status = screen.getByRole('status')
    expect(status).toBeTruthy()
    expect(screen.getByText('Machina is thinking')).toBeTruthy()
  })

  it('renders three animation dots hidden from assistive tech', () => {
    const { container } = render(<ThinkingIndicator />)
    const dots = container.querySelectorAll('.te-pulse-thinking-dot')
    expect(dots.length).toBe(3)
    for (const dot of dots) {
      expect(dot.getAttribute('aria-hidden')).toBe('true')
    }
  })
})
