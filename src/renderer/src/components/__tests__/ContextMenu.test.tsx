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

  it('renders section headers and separators as non-interactive rows', () => {
    render(
      <ContextMenu
        position={{ x: 10, y: 10 }}
        onClose={() => {}}
        items={[
          { kind: 'header', id: 'h', label: 'Content' },
          { id: 'a', label: 'Alpha', onSelect: () => {} },
          { kind: 'separator', id: 's' },
          { id: 'b', label: 'Beta', onSelect: () => {} }
        ]}
      />
    )
    const header = screen.getByText('Content')
    expect(header.closest('button')).toBeNull()
    expect(screen.getByRole('separator')).toBeTruthy()
    expect(screen.getAllByRole('menuitem')).toHaveLength(2)
  })

  it('keyboard navigation skips headers and separators', () => {
    const onAlpha = vi.fn()
    const onBeta = vi.fn()
    render(
      <ContextMenu
        position={{ x: 10, y: 10 }}
        onClose={() => {}}
        items={[
          { kind: 'header', id: 'h', label: 'Section' },
          { id: 'a', label: 'Alpha', onSelect: onAlpha },
          { kind: 'separator', id: 's' },
          { id: 'b', label: 'Beta', onSelect: onBeta }
        ]}
      />
    )
    // Active starts on Alpha (first selectable); ArrowDown lands on Beta
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onAlpha).not.toHaveBeenCalled()
    expect(onBeta).toHaveBeenCalledTimes(1)
  })

  it('renders shortcut labels', () => {
    render(
      <ContextMenu
        position={{ x: 10, y: 10 }}
        onClose={() => {}}
        items={[{ id: 'a', label: 'Open in Split', shortcut: '⌘\\', onSelect: () => {} }]}
      />
    )
    expect(screen.getByText('⌘\\')).toBeTruthy()
  })

  it('renders item icons', () => {
    const Icon = (props: { size?: number }) => <svg data-testid="item-icon" {...props} />
    render(
      <ContextMenu
        position={{ x: 10, y: 10 }}
        onClose={() => {}}
        items={[
          { id: 'a', label: 'Text', icon: Icon as never, onSelect: () => {} },
          { id: 'b', label: 'Plain', onSelect: () => {} }
        ]}
      />
    )
    expect(screen.getByTestId('item-icon')).toBeTruthy()
  })

  it('applies the testId to the menu container', () => {
    render(
      <ContextMenu
        position={{ x: 10, y: 10 }}
        onClose={() => {}}
        testId="canvas-context-menu"
        items={[{ id: 'a', label: 'Run', onSelect: () => {} }]}
      />
    )
    expect(screen.getByTestId('canvas-context-menu')).toBeTruthy()
  })
})
