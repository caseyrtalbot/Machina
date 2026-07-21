import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { Overlay } from '../Overlay'
import { zIndex } from '../../../design/tokens'

function backdropOf(container: HTMLElement): HTMLElement {
  const el = container.firstElementChild
  if (!(el instanceof HTMLElement)) throw new Error('overlay did not render')
  return el
}

describe('Overlay', () => {
  it('renders nothing when closed and not keepMounted', () => {
    const { container } = render(
      <Overlay open={false} onClose={() => {}}>
        <p>content</p>
      </Overlay>
    )
    expect(container.firstElementChild).toBeNull()
  })

  it('renders children with the modal z-index token by default', () => {
    const { container, getByText } = render(
      <Overlay open onClose={() => {}}>
        <p>content</p>
      </Overlay>
    )
    expect(getByText('content')).toBeTruthy()
    expect(backdropOf(container).style.zIndex).toBe(String(zIndex.modal))
    expect(backdropOf(container).style.position).toBe('fixed')
  })

  it('closes on capture-phase Escape', () => {
    const onClose = vi.fn()
    render(
      <Overlay open onClose={onClose}>
        <p>content</p>
      </Overlay>
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ignores Escape and click-outside while canDismiss is false', () => {
    const onClose = vi.fn()
    const { container } = render(
      <Overlay open onClose={onClose} canDismiss={false}>
        <p>content</p>
      </Overlay>
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.mouseDown(backdropOf(container))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on backdrop mousedown but not on panel mousedown', () => {
    const onClose = vi.fn()
    const { container, getByText } = render(
      <Overlay open onClose={onClose}>
        <p>content</p>
      </Overlay>
    )
    fireEvent.mouseDown(getByText('content'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.mouseDown(backdropOf(container))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keepMounted keeps a closed overlay in the DOM, inert and invisible', () => {
    const { container, getByText, rerender } = render(
      <Overlay open keepMounted onClose={() => {}}>
        <p>content</p>
      </Overlay>
    )
    rerender(
      <Overlay open={false} keepMounted onClose={() => {}}>
        <p>content</p>
      </Overlay>
    )
    expect(getByText('content')).toBeTruthy()
    const backdrop = backdropOf(container)
    expect(backdrop.style.opacity).toBe('0')
    expect(backdrop.style.pointerEvents).toBe('none')
  })

  it('keepMounted closed overlay does not react to Escape', () => {
    const onClose = vi.fn()
    render(
      <Overlay open={false} keepMounted onClose={onClose}>
        <p>content</p>
      </Overlay>
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('top variant applies the offset and flex-start alignment', () => {
    const { container } = render(
      <Overlay open variant="top" topOffset="12vh" onClose={() => {}}>
        <p>content</p>
      </Overlay>
    )
    const backdrop = backdropOf(container)
    expect(backdrop.style.alignItems).toBe('flex-start')
    expect(backdrop.style.paddingTop).toBe('12vh')
  })

  it('parent containment renders position absolute', () => {
    const { container } = render(
      <Overlay open containment="parent" onClose={() => {}}>
        <p>content</p>
      </Overlay>
    )
    expect(backdropOf(container).style.position).toBe('absolute')
  })

  it('popover variant is scrimless and closes only on outside mousedown', () => {
    const onClose = vi.fn()
    const { container, getByText } = render(
      <div>
        <button>outside</button>
        <Overlay open variant="popover" zLayer="dockPopover" onClose={onClose}>
          <p>popover content</p>
        </Overlay>
      </div>
    )
    const popover = getByText('popover content').parentElement
    if (!(popover instanceof HTMLElement)) throw new Error('popover missing')
    expect(popover.style.zIndex).toBe(String(zIndex.dockPopover))
    expect(popover.style.background).toBe('')

    fireEvent.mouseDown(getByText('popover content'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.mouseDown(getByText('outside'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(container).toBeTruthy()
  })
})
