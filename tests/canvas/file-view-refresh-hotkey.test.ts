import { describe, it, expect, afterEach } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  createEditorExtensions,
  shouldIgnoreCanvasHotkey
} from '@renderer/panels/canvas/shared/codemirror-setup'

function keydown(
  target: EventTarget,
  init: KeyboardEventInit = {}
): { event: KeyboardEvent; reachedWindow: boolean } {
  let reachedWindow = false
  const listener = () => {
    reachedWindow = true
  }
  window.addEventListener('keydown', listener)
  const event = new KeyboardEvent('keydown', { key: 'r', bubbles: true, ...init })
  target.dispatchEvent(event)
  window.removeEventListener('keydown', listener)
  return { event, reachedWindow }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('shouldIgnoreCanvasHotkey', () => {
  it('allows a bare r keypress on a non-editing target', () => {
    const { event } = keydown(document.body)
    expect(shouldIgnoreCanvasHotkey(event)).toBe(false)
  })

  it.each([
    ['metaKey', { metaKey: true }],
    ['ctrlKey', { ctrlKey: true }],
    ['altKey', { altKey: true }],
    ['shiftKey', { shiftKey: true }]
  ] as const)('ignores when %s is held (Cmd+R must pass through)', (_name, init) => {
    const { event } = keydown(document.body, init)
    expect(shouldIgnoreCanvasHotkey(event)).toBe(true)
  })

  it('ignores keystrokes originating inside a .cm-editor', () => {
    const editor = document.createElement('div')
    editor.className = 'cm-editor'
    const content = document.createElement('div')
    editor.appendChild(content)
    document.body.appendChild(editor)

    const { event } = keydown(content)
    expect(shouldIgnoreCanvasHotkey(event)).toBe(true)
  })

  it.each(['input', 'textarea'] as const)('ignores keystrokes in a %s', (tag) => {
    const el = document.createElement(tag)
    document.body.appendChild(el)

    const { event } = keydown(el)
    expect(shouldIgnoreCanvasHotkey(event)).toBe(true)
  })

  it('ignores keystrokes in a contentEditable element', () => {
    const el = document.createElement('div')
    el.contentEditable = 'true'
    document.body.appendChild(el)

    const { event } = keydown(el)
    expect(shouldIgnoreCanvasHotkey(event)).toBe(true)
  })
})

describe('createEditorExtensions keydown isolation', () => {
  it('stops keydown propagation so window-level hotkeys never fire while typing', async () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const extensions = await createEditorExtensions('markdown')
    const view = new EditorView({
      state: EditorState.create({ doc: 'hello', extensions }),
      parent
    })

    const { reachedWindow } = keydown(view.contentDOM)
    expect(reachedWindow).toBe(false)

    view.destroy()
  })

  it('control: keydown outside the editor still reaches window listeners', () => {
    const { reachedWindow } = keydown(document.body)
    expect(reachedWindow).toBe(true)
  })
})
