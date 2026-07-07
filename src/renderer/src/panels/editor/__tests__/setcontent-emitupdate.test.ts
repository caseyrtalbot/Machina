import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'

// Regression lock for the file-corruption bug. Tiptap 3 flipped setContent's
// `emitUpdate` default from false (v2) to true, so loading a file into the
// editor fires onUpdate → handleUpdate → doc.update → autosave, rewriting the
// file through the lossy markdown round-trip on open. EditorPanel's load effect
// must pass `{ emitUpdate: false }`. This test pins the underlying API contract
// so a dependency bump can't silently reintroduce the trap.
describe('setContent emitUpdate contract (Tiptap 3)', () => {
  let editor: Editor
  const onUpdate = vi.fn()

  beforeEach(() => {
    onUpdate.mockClear()
    editor = new Editor({
      element: document.createElement('div'),
      extensions: [StarterKit.configure({ codeBlock: false }), Markdown],
      onUpdate
    })
    onUpdate.mockClear() // ignore construction-time emissions
  })

  afterEach(() => {
    editor.destroy()
  })

  it('does NOT emit onUpdate when loading content with emitUpdate:false (the fix)', () => {
    const json = editor.storage.markdown.manager.parse('# Loaded from disk')
    editor.commands.setContent(json, { emitUpdate: false })
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('DOES emit onUpdate on a default setContent (proves the default is the trap)', () => {
    const json = editor.storage.markdown.manager.parse('# Loaded from disk')
    editor.commands.setContent(json)
    expect(onUpdate).toHaveBeenCalled()
  })
})
