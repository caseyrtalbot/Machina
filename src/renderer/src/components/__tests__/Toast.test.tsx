import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ToastHost, showToast } from '../Toast'

describe('Toast', () => {
  it('showToast renders a message in the host', () => {
    render(<ToastHost />)
    act(() => showToast('Failed to save canvas'))
    expect(screen.getByRole('alert').textContent).toBe('Failed to save canvas')
  })

  it('clicking a toast dismisses it', () => {
    render(<ToastHost />)
    act(() => showToast('dismiss me'))
    fireEvent.click(screen.getByRole('alert'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('stacks multiple toasts', () => {
    render(<ToastHost />)
    act(() => {
      showToast('first')
      showToast('second')
    })
    expect(screen.getAllByRole('alert')).toHaveLength(2)
  })

  it('queues messages shown before the host mounts', () => {
    showToast('queued before mount')
    render(<ToastHost />)
    expect(screen.getByRole('alert').textContent).toBe('queued before mount')
  })
})
