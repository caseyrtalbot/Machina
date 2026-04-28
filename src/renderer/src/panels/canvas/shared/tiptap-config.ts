import type { AnyExtension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { ConceptNodeMark } from '../../editor/extensions/concept-node-mark'
import { MermaidCodeBlock } from '../../editor/extensions/mermaid-code-block'
import { CalloutBlock } from '../../editor/extensions/callout-block'
import { HighlightMark } from '../../editor/extensions/highlight-mark'
import { WikilinkNode } from '../../editor/extensions/wikilink-node'
import { MachinaTableKit } from '../../editor/extensions/table-kit'

interface TiptapConfigOptions {
  onWikilinkNavigate?: (target: string) => void
}

export function getCanvasEditorExtensions(options?: TiptapConfigOptions): AnyExtension[] {
  return [
    StarterKit.configure({ codeBlock: false }),
    MermaidCodeBlock,
    Markdown,
    TaskList,
    TaskItem.configure({ nested: true }),
    ConceptNodeMark,
    CalloutBlock,
    HighlightMark,
    WikilinkNode.configure({ onNavigate: options?.onWikilinkNavigate }),
    MachinaTableKit
  ]
}
