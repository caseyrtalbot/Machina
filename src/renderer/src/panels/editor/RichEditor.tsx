import type { Editor } from '@tiptap/react'
import { EditorContent } from '@tiptap/react'

interface RichEditorProps {
  editor: Editor | null
}

export function RichEditor({ editor }: RichEditorProps) {
  return (
    <div className="te-richeditor">
      <EditorContent editor={editor} />
    </div>
  )
}
