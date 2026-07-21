import { describe, it, expect } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import { useRef } from 'react'
import { useFocusTrap } from '../useFocusTrap'

function TrapHarness({
  active = true,
  restoreFocus = true,
  withInitial = false
}: {
  active?: boolean
  restoreFocus?: boolean
  withInitial?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const initialRef = useRef<HTMLButtonElement>(null)
  const { onKeyDown } = useFocusTrap(containerRef, {
    active,
    restoreFocus,
    initialFocusRef: withInitial ? initialRef : undefined
  })
  return (
    <div ref={containerRef} onKeyDown={onKeyDown} data-testid="trap">
      <button ref={initialRef}>first</button>
      <input aria-label="middle" />
      <button disabled>skipped</button>
      <button>last</button>
    </div>
  )
}

describe('useFocusTrap', () => {
  it('focuses the initial target when active', () => {
    render(<TrapHarness withInitial />)
    expect(document.activeElement?.textContent).toBe('first')
  })

  it('leaves focus alone without an initialFocusRef', () => {
    render(<TrapHarness />)
    expect(document.activeElement?.textContent).not.toBe('first')
  })

  it('wraps Tab from the last focusable to the first, skipping disabled', () => {
    render(<TrapHarness />)
    screen.getByText('last').focus()
    fireEvent.keyDown(screen.getByTestId('trap'), { key: 'Tab' })
    expect(document.activeElement?.textContent).toBe('first')
  })

  it('wraps Shift+Tab from the first focusable to the last', () => {
    render(<TrapHarness />)
    screen.getByText('first').focus()
    fireEvent.keyDown(screen.getByTestId('trap'), { key: 'Tab', shiftKey: true })
    expect(document.activeElement?.textContent).toBe('last')
  })

  it('does not intercept Tab mid-list', () => {
    render(<TrapHarness />)
    const middle = screen.getByLabelText('middle')
    middle.focus()
    fireEvent.keyDown(screen.getByTestId('trap'), { key: 'Tab' })
    expect(document.activeElement).toBe(middle)
  })

  it('restores focus to the previously focused element on unmount', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    const { unmount } = render(<TrapHarness withInitial />)
    expect(document.activeElement?.textContent).toBe('first')
    unmount()
    expect(document.activeElement).toBe(outside)
    outside.remove()
  })

  it('skips focus restore when restoreFocus is false', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    const { unmount } = render(<TrapHarness withInitial restoreFocus={false} />)
    unmount()
    expect(document.activeElement).not.toBe(outside)
    outside.remove()
  })
})
