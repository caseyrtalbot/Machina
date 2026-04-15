import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { SaveTextCardDialog } from '../SaveTextCardDialog'

const baseProps = {
  initialFilename: 'my-note',
  folders: ['Inbox', 'Notes', 'Notes/2026'],
  files: ['Notes/journal.md', 'Inbox/scratch.md'],
  onClose: vi.fn(),
  onSaveNew: vi.fn(),
  onSaveAppend: vi.fn()
}

function findRadio(label: RegExp): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement
}

describe('SaveTextCardDialog', () => {
  it('starts in New mode with filename pre-filled', () => {
    render(<SaveTextCardDialog {...baseProps} />)
    expect((screen.getByDisplayValue('my-note') as HTMLInputElement).value).toBe('my-note')
    expect(findRadio(/new file/i).checked).toBe(true)
  })

  it('switches to Append mode when toggled', () => {
    render(<SaveTextCardDialog {...baseProps} />)
    act(() => {
      fireEvent.click(findRadio(/append to existing/i))
    })
    expect(findRadio(/append to existing/i).checked).toBe(true)
    expect(screen.getByPlaceholderText(/search vault files/i)).toBeTruthy()
  })

  it('disables Save in New mode when filename is empty', () => {
    render(<SaveTextCardDialog {...baseProps} />)
    const filename = screen.getByDisplayValue('my-note') as HTMLInputElement
    act(() => {
      fireEvent.change(filename, { target: { value: '' } })
    })
    const save = screen.getByRole('button', { name: /^save$/i }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
  })

  it('calls onSaveNew with chosen folder and filename', () => {
    const onSaveNew = vi.fn()
    render(<SaveTextCardDialog {...baseProps} onSaveNew={onSaveNew} />)
    act(() => {
      fireEvent.click(screen.getByText('Notes/2026'))
    })
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    })
    expect(onSaveNew).toHaveBeenCalledWith({ folder: 'Notes/2026', filename: 'my-note' })
  })

  it('disables Save in Append mode until a file is selected', () => {
    render(<SaveTextCardDialog {...baseProps} />)
    act(() => {
      fireEvent.click(findRadio(/append to existing/i))
    })
    let save = screen.getByRole('button', { name: /^save$/i }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    act(() => {
      fireEvent.click(screen.getByText('Notes/journal.md'))
    })
    save = screen.getByRole('button', { name: /^save$/i }) as HTMLButtonElement
    expect(save.disabled).toBe(false)
  })

  it('calls onSaveAppend with selected file path', () => {
    const onSaveAppend = vi.fn()
    render(<SaveTextCardDialog {...baseProps} onSaveAppend={onSaveAppend} />)
    act(() => {
      fireEvent.click(findRadio(/append to existing/i))
    })
    act(() => {
      fireEvent.click(screen.getByText('Inbox/scratch.md'))
    })
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    })
    expect(onSaveAppend).toHaveBeenCalledWith('Inbox/scratch.md')
  })

  it('filters files by search input', () => {
    render(<SaveTextCardDialog {...baseProps} />)
    act(() => {
      fireEvent.click(findRadio(/append to existing/i))
    })
    const search = screen.getByPlaceholderText(/search vault files/i) as HTMLInputElement
    act(() => {
      fireEvent.change(search, { target: { value: 'journal' } })
    })
    expect(screen.getByText('Notes/journal.md')).toBeTruthy()
    expect(screen.queryByText('Inbox/scratch.md')).toBeNull()
  })

  it('closes when Cancel clicked', () => {
    const onClose = vi.fn()
    render(<SaveTextCardDialog {...baseProps} onClose={onClose} />)
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    })
    expect(onClose).toHaveBeenCalled()
  })
})
