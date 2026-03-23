import type { AnyExtension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Link from '@tiptap/extension-link'
import { ConceptNodeMark } from '../../editor/extensions/concept-node-mark'
import { MermaidCodeBlock } from '../../editor/extensions/mermaid-code-block'
import { CalloutBlock } from '../../editor/extensions/callout-block'
import { HighlightMark } from '../../editor/extensions/highlight-mark'

export function getCanvasEditorExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({ codeBlock: false }),
    MermaidCodeBlock,
    Markdown,
    TaskList,
    TaskItem.configure({ nested: true }),
    Link.configure({ openOnClick: false, HTMLAttributes: { rel: null, target: null } }),
    ConceptNodeMark,
    CalloutBlock,
    HighlightMark
  ]
}
