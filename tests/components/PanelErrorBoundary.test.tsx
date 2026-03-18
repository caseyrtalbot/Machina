import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PanelErrorBoundary } from '../../src/renderer/src/components/PanelErrorBoundary'

function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('Test error')
  return <div>Child content</div>
}

describe('PanelErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <PanelErrorBoundary name="Graph">
        <ThrowingChild shouldThrow={false} />
      </PanelErrorBoundary>
    )
    expect(screen.getByText('Child content')).toBeDefined()
  })

  it('shows fallback on error', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <PanelErrorBoundary name="Graph">
        <ThrowingChild shouldThrow={true} />
      </PanelErrorBoundary>
    )
    expect(screen.getByText('Something went wrong')).toBeDefined()
    expect(screen.getByText(/Graph/)).toBeDefined()
    consoleSpy.mockRestore()
  })

  it('retries on button click', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    function Toggler({ shouldThrow }: { shouldThrow: boolean }) {
      return (
        <PanelErrorBoundary name="Toggle">
          {shouldThrow ? <ThrowingChild shouldThrow={true} /> : <div>Recovered</div>}
        </PanelErrorBoundary>
      )
    }

    const { rerender } = render(<Toggler shouldThrow={true} />)
    expect(screen.getByText('Something went wrong')).toBeDefined()

    // Update the flag so children will render successfully after retry
    rerender(<Toggler shouldThrow={false} />)
    fireEvent.click(screen.getByText('Retry'))

    expect(screen.getByText('Recovered')).toBeDefined()
    expect(screen.queryByText('Something went wrong')).toBeNull()

    consoleSpy.mockRestore()
  })
})
