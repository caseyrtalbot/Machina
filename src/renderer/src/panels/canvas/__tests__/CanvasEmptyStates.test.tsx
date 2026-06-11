import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CanvasEmptyVaultCard, ShortcutOverlay } from '../CanvasEmptyStates'

describe('CanvasEmptyVaultCard', () => {
  it('offers create-note, import, and drag-files paths', () => {
    const onCreateNote = vi.fn()
    const onOpenImport = vi.fn()
    render(<CanvasEmptyVaultCard onCreateNote={onCreateNote} onOpenImport={onOpenImport} />)

    fireEvent.click(screen.getByText('New Note'))
    expect(onCreateNote).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('Import ⌘G'))
    expect(onOpenImport).toHaveBeenCalledTimes(1)

    // Drag-files CTA is a hint, not a button
    expect(screen.getByText(/drag markdown, images, and PDFs/i)).toBeTruthy()
    // Names the shortcut overlay trigger
    expect(screen.getByText(/Press \? for keyboard shortcuts/i)).toBeTruthy()
  })
})

describe('ShortcutOverlay', () => {
  it('lists canvas shortcuts', () => {
    render(<ShortcutOverlay onClose={() => {}} />)
    expect(screen.getByText('Canvas Shortcuts')).toBeTruthy()
    expect(screen.getByText('New note at cursor')).toBeTruthy()
    expect(screen.getByText('Import from vault')).toBeTruthy()
  })

  it('dismisses on click', () => {
    const onClose = vi.fn()
    render(<ShortcutOverlay onClose={onClose} />)
    fireEvent.click(screen.getByTestId('canvas-shortcut-overlay'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('dismisses on Escape', () => {
    const onClose = vi.fn()
    render(<ShortcutOverlay onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
