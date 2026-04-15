import { describe, it, expect, vi } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { RichTextCardEditor } from '../RichTextCardEditor'

describe('RichTextCardEditor', () => {
  it('renders the initial markdown content', () => {
    render(
      <RichTextCardEditor
        value="hello world"
        editing={false}
        onChange={() => {}}
        onExit={() => {}}
        onSaveShortcut={() => {}}
      />
    )
    // getByText throws if missing, so its success is the assertion here.
    // (jest-dom matchers like toBeInTheDocument are not set up in this repo.)
    expect(screen.getByText('hello world')).toBeTruthy()
  })

  it('fires onChange with markdown when content is typed', () => {
    const onChange = vi.fn()
    render(
      <RichTextCardEditor
        value=""
        editing={true}
        onChange={onChange}
        onExit={() => {}}
        onSaveShortcut={() => {}}
      />
    )
    const editable = document.querySelector('[contenteditable="true"]') as HTMLElement
    expect(editable).toBeTruthy()
    editable.focus()
    // happy-dom doesn't fully implement Selection/Range APIs, so ProseMirror
    // can't observe simulated keystrokes or input events. Paste handling is
    // the exception: ProseMirror reads pastes from the clipboardData directly
    // and dispatches an insertion transaction, which flows through onUpdate.
    act(() => {
      const dt = new DataTransfer()
      dt.setData('text/plain', 'hi')
      fireEvent.paste(editable, { clipboardData: dt })
    })
    expect(onChange).toHaveBeenCalled()
    const calls = onChange.mock.calls.map((c) => c[0])
    expect(calls.some((c) => typeof c === 'string' && c.includes('hi'))).toBe(true)
  })

  it('fires onExit(true) on Cmd+Enter', () => {
    const onExit = vi.fn()
    render(
      <RichTextCardEditor
        value="text"
        editing={true}
        onChange={() => {}}
        onExit={onExit}
        onSaveShortcut={() => {}}
      />
    )
    const editable = document.querySelector('[contenteditable="true"]') as HTMLElement
    editable.focus()
    act(() => {
      fireEvent.keyDown(editable, { key: 'Enter', metaKey: true })
    })
    expect(onExit).toHaveBeenCalledWith(true)
  })

  it('fires onExit(false) on Escape', () => {
    const onExit = vi.fn()
    render(
      <RichTextCardEditor
        value="text"
        editing={true}
        onChange={() => {}}
        onExit={onExit}
        onSaveShortcut={() => {}}
      />
    )
    const editable = document.querySelector('[contenteditable="true"]') as HTMLElement
    editable.focus()
    act(() => {
      fireEvent.keyDown(editable, { key: 'Escape' })
    })
    expect(onExit).toHaveBeenCalledWith(false)
  })

  it('fires onSaveShortcut on Cmd+Shift+S', () => {
    const onSaveShortcut = vi.fn()
    render(
      <RichTextCardEditor
        value="text"
        editing={true}
        onChange={() => {}}
        onExit={() => {}}
        onSaveShortcut={onSaveShortcut}
      />
    )
    const editable = document.querySelector('[contenteditable="true"]') as HTMLElement
    editable.focus()
    act(() => {
      fireEvent.keyDown(editable, {
        key: 'S',
        code: 'KeyS',
        metaKey: true,
        shiftKey: true
      })
    })
    expect(onSaveShortcut).toHaveBeenCalled()
  })

  it('stops keydown propagation so canvas shortcuts do not fire', () => {
    const outer = vi.fn()
    render(
      <div onKeyDown={outer}>
        <RichTextCardEditor
          value=""
          editing={true}
          onChange={() => {}}
          onExit={() => {}}
          onSaveShortcut={() => {}}
        />
      </div>
    )
    const editable = document.querySelector('[contenteditable="true"]') as HTMLElement
    editable.focus()
    act(() => {
      fireEvent.keyDown(editable, { key: 'a' })
    })
    expect(outer).not.toHaveBeenCalled()
  })

  it('toggles editable state when editing prop changes', () => {
    const { rerender } = render(
      <RichTextCardEditor
        value="text"
        editing={false}
        onChange={() => {}}
        onExit={() => {}}
        onSaveShortcut={() => {}}
      />
    )
    let editable = document.querySelector('[contenteditable]') as HTMLElement
    expect(editable.getAttribute('contenteditable')).toBe('false')

    act(() => {
      rerender(
        <RichTextCardEditor
          value="text"
          editing={true}
          onChange={() => {}}
          onExit={() => {}}
          onSaveShortcut={() => {}}
        />
      )
    })
    editable = document.querySelector('[contenteditable]') as HTMLElement
    expect(editable.getAttribute('contenteditable')).toBe('true')
  })
})
