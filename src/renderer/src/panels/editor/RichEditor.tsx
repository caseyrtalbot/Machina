import type { Editor } from '@tiptap/react'
import { EditorContent } from '@tiptap/react'
import { colors } from '../../design/tokens'

interface RichEditorProps {
  editor: Editor | null
}

export function RichEditor({ editor }: RichEditorProps) {
  return (
    <div className="h-full">
      <EditorContent editor={editor} />
    </div>
  )
}
