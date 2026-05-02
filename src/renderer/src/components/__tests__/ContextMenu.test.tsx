import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ContextMenu } from '../ContextMenu'

describe('ContextMenu', () => {
  it('renders enabled and disabled items', () => {
    render(
      <ContextMenu
        position={{ x: 10, y: 10 }}
        onClose={() => {}}
        items={[
          { id: 'a', label: 'Alpha', onSelect: () => {} },
          { id: 'b', label: 'Beta', onSelect: () => {}, disabled: true }
        ]}
      />
    )
    expect(screen.getByText('Alpha')).toBeTruthy()
    const beta = screen.getByText('Beta') as HTMLButtonElement
    expect(beta.closest('button')?.disabled).toBe(true)
  })

  it('selecting an item invokes onSelect and closes', () => {
    const onClose = vi.fn()
    const onSelect = vi.fn()
    render(
      <ContextMenu
        position={{ x: 10, y: 10 }}
        onClose={onClose}
        items={[{ id: 'a', label: 'Run', onSelect }]}
      />
    )
    fireEvent.click(screen.getByText('Run'))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape closes the menu', () => {
    const onClose = vi.fn()
    render(
      <ContextMenu
        position={{ x: 10, y: 10 }}
        onClose={onClose}
        items={[{ id: 'a', label: 'Run', onSelect: () => {} }]}
      />
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('Enter activates the active item', () => {
    const onClose = vi.fn()
    const onSelect = vi.fn()
    render(
      <ContextMenu
        position={{ x: 10, y: 10 }}
        onClose={onClose}
        items={[{ id: 'a', label: 'Run', onSelect }]}
      />
    )
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('outside pointerdown closes the menu', () => {
    const onClose = vi.fn()
    render(
      <ContextMenu
        position={{ x: 10, y: 10 }}
        onClose={onClose}
        items={[{ id: 'a', label: 'Run', onSelect: () => {} }]}
      />
    )
    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalled()
  })
})
