import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CardContextMenu } from '../CardContextMenu'

function renderMenu(overrides: Partial<React.ComponentProps<typeof CardContextMenu>> = {}) {
  const defaults: React.ComponentProps<typeof CardContextMenu> = {
    x: 100,
    y: 200,
    onShowConnections: vi.fn(),
    onOpenInEditor: vi.fn(),
    onCopyPath: vi.fn(),
    onClose: vi.fn()
  }
  const props = { ...defaults, ...overrides }
  return { ...render(<CardContextMenu {...props} />), props }
}

describe('CardContextMenu', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders live card actions without the removed Claude action', () => {
    renderMenu()

    expect(screen.getByText('Show Connections')).toBeTruthy()
    expect(screen.getByText('Open in Editor')).toBeTruthy()
    expect(screen.getByText('Copy Path')).toBeTruthy()
    expect(screen.queryByText('Run Claude on this note')).toBeNull()
  })

  it('calls onShowConnections and onClose when Show Connections is clicked', () => {
    const onShowConnections = vi.fn()
    const onClose = vi.fn()
    renderMenu({ onShowConnections, onClose })

    fireEvent.click(screen.getByText('Show Connections'))

    expect(onShowConnections).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onOpenInEditor and onClose when Open in Editor is clicked', () => {
    const onOpenInEditor = vi.fn()
    const onClose = vi.fn()
    renderMenu({ onOpenInEditor, onClose })

    fireEvent.click(screen.getByText('Open in Editor'))

    expect(onOpenInEditor).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onCopyPath and onClose when Copy Path is clicked', () => {
    const onCopyPath = vi.fn()
    const onClose = vi.fn()
    renderMenu({ onCopyPath, onClose })

    fireEvent.click(screen.getByText('Copy Path'))

    expect(onCopyPath).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renders text save actions only when their handlers are provided', () => {
    renderMenu({ onOpenInEditor: undefined })
    expect(screen.queryByText('Open in Editor')).toBeNull()
    expect(screen.queryByText('Save as new note')).toBeNull()
    cleanup()

    const onQuickSaveText = vi.fn()
    const onSaveTextAs = vi.fn()
    renderMenu({ onQuickSaveText, onSaveTextAs })

    fireEvent.click(screen.getByText('Save as new note'))
    fireEvent.click(screen.getByText('Save to...'))

    expect(onQuickSaveText).toHaveBeenCalledOnce()
    expect(onSaveTextAs).toHaveBeenCalledOnce()
  })
})
