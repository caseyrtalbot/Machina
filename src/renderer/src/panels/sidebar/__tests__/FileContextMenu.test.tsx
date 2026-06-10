import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockSelectionState = {
  agentModifiedPaths: new Set<string>(),
  selectedPaths: new Set<string>()
}

const mockUiState = {
  bookmarkedPaths: [] as string[]
}

vi.mock('../../../store/sidebar-selection-store', () => ({
  useSidebarSelectionStore: vi.fn((selector: (s: typeof mockSelectionState) => unknown) =>
    selector(mockSelectionState)
  )
}))

vi.mock('../../../store/ui-store', () => ({
  useUiStore: vi.fn((selector: (s: typeof mockUiState) => unknown) => selector(mockUiState))
}))

import { FileContextMenu } from '../FileContextMenu'

const fileState = { x: 50, y: 300, path: 'notes/a.md', isDirectory: false }

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  mockSelectionState.agentModifiedPaths = new Set()
  mockSelectionState.selectedPaths = new Set()
  mockUiState.bookmarkedPaths = []
})

describe('FileContextMenu', () => {
  it('renders nothing when state is null', () => {
    const { container } = render(
      <FileContextMenu state={null} onClose={() => {}} onAction={() => {}} />
    )
    expect(container.innerHTML).toBe('')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('renders file actions with shortcut labels via the shared primitive', () => {
    render(<FileContextMenu state={fileState} onClose={() => {}} onAction={() => {}} />)
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(screen.getByText('Bookmark')).toBeTruthy()
    expect(screen.getByText('Open in Split')).toBeTruthy()
    expect(screen.getByText('⌘\\')).toBeTruthy()
    expect(screen.getByText('Delete')).toBeTruthy()
  })

  it('invokes onAction with the action id and path, then closes', () => {
    const onAction = vi.fn()
    const onClose = vi.fn()
    render(<FileContextMenu state={fileState} onClose={onClose} onAction={onAction} />)
    fireEvent.click(screen.getByText('Duplicate'))
    expect(onAction).toHaveBeenCalledWith('duplicate', 'notes/a.md')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows folder actions for directories', () => {
    render(
      <FileContextMenu
        state={{ ...fileState, path: 'notes', isDirectory: true }}
        onClose={() => {}}
        onAction={() => {}}
      />
    )
    expect(screen.getByText('New note in folder')).toBeTruthy()
    expect(screen.getByText('Map to Canvas')).toBeTruthy()
    expect(screen.queryByText('Duplicate')).toBeNull()
  })

  it('shows bulk actions when the path is part of a multi-selection', () => {
    mockSelectionState.selectedPaths = new Set(['notes/a.md', 'notes/b.md', 'notes/c.md'])
    render(<FileContextMenu state={fileState} onClose={() => {}} onAction={() => {}} />)
    expect(screen.getByText('Add 3 files to Canvas')).toBeTruthy()
    expect(screen.getByText('Delete 3 files')).toBeTruthy()
    expect(screen.queryByText('Bookmark')).toBeNull()
  })

  it('offers Mark as Reviewed for agent-modified files', () => {
    mockSelectionState.agentModifiedPaths = new Set(['notes/a.md'])
    render(<FileContextMenu state={fileState} onClose={() => {}} onAction={() => {}} />)
    expect(screen.getByText('Mark as Reviewed')).toBeTruthy()
  })
})
