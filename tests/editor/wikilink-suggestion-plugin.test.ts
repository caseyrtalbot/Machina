import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { WikilinkNode } from '../../src/renderer/src/panels/editor/extensions/wikilink-node'

function pluginKeys(editor: Editor): string[] {
  return editor.state.plugins.map((p) => (p.spec.key as { key?: string } | undefined)?.key ?? '')
}

describe('WikilinkNode suggestion wiring', () => {
  it('registers the wikilinkSuggestion plugin on the editor', () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: [StarterKit, WikilinkNode]
    })
    expect(pluginKeys(editor).some((k) => k.startsWith('wikilinkSuggestion'))).toBe(true)
    editor.destroy()
  })

  it('keeps the click plugin when onNavigate is configured', () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: [StarterKit, WikilinkNode.configure({ onNavigate: () => {} })]
    })
    const keys = pluginKeys(editor)
    expect(keys.some((k) => k.startsWith('wikilinkSuggestion'))).toBe(true)
    expect(keys.some((k) => k.startsWith('wikilinkClick'))).toBe(true)
    editor.destroy()
  })
})
