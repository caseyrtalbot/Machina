import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import { useRef } from 'react'
import { Modal } from '../Modal'

function InitialFocusModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  return (
    <Modal open={open} onClose={onClose} ariaLabel="test dialog" initialFocusRef={closeRef}>
      <button ref={closeRef}>close</button>
      <input aria-label="field" />
    </Modal>
  )
}

describe('Modal', () => {
  it('renders a role=dialog panel with aria-modal', () => {
    render(
      <Modal open onClose={() => {}} ariaLabel="test dialog">
        <p>body</p>
      </Modal>
    )
    const dialog = screen.getByRole('dialog', { name: 'test dialog' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
  })

  it('applies the entrance animation class by default, but not when keepMounted', () => {
    const { rerender } = render(
      <Modal open onClose={() => {}} ariaLabel="test dialog">
        <p>body</p>
      </Modal>
    )
    expect(screen.getByRole('dialog').className).toContain('te-popover-enter')
    rerender(
      <Modal open keepMounted onClose={() => {}} ariaLabel="test dialog">
        <p>body</p>
      </Modal>
    )
    expect(screen.getByRole('dialog').className).not.toContain('te-popover-enter')
  })

  it('focuses the initialFocusRef on open and restores focus on close', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    const { rerender } = render(<InitialFocusModal open onClose={() => {}} />)
    expect(document.activeElement?.textContent).toBe('close')
    rerender(<InitialFocusModal open={false} onClose={() => {}} />)
    expect(document.activeElement).toBe(outside)
    outside.remove()
  })

  it('traps Tab within the panel', () => {
    render(
      <Modal open onClose={() => {}} ariaLabel="test dialog">
        <button>first</button>
        <button>last</button>
      </Modal>
    )
    const dialog = screen.getByRole('dialog')
    screen.getByText('last').focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(document.activeElement?.textContent).toBe('first')
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(document.activeElement?.textContent).toBe('last')
  })

  it('closes on Escape through the Overlay base', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} ariaLabel="test dialog">
        <p>body</p>
      </Modal>
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
