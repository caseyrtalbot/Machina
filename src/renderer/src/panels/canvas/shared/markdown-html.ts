import { Editor, generateHTML } from '@tiptap/core'
import { getCanvasEditorExtensions } from './tiptap-config'

// Separate extension instances for parser vs generateHTML.
// Tiptap mutates extension state during Editor construction;
// sharing the same array between Editor and generateHTML is unsafe.
const parserExtensions = getCanvasEditorExtensions()
const renderExtensions = getCanvasEditorExtensions()

// Headless editor for markdown parsing only. Never mounted to DOM.
let parserEditor: Editor | null = null

function getParser(): Editor {
  if (!parserEditor) {
    parserEditor = new Editor({ extensions: parserExtensions, content: '' })
  }
  return parserEditor
}

export function markdownToHtml(markdown: string): string {
  if (!markdown || !markdown.trim()) return ''
  const editor = getParser()
  const manager = editor.storage.markdown?.manager
  if (!manager) return ''
  const doc = manager.parse(markdown)
  return generateHTML(doc, renderExtensions)
}
