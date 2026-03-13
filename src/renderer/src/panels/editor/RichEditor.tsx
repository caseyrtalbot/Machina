import { useEditor, EditorContent } from '@tiptap/react'
import { useEffect } from 'react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { colors } from '../../design/tokens'

interface RichEditorProps {
  content: string
  onChange: (markdown: string) => void
}

export function RichEditor({ content, onChange }: RichEditorProps) {
  const editor = useEditor({
    extensions: [StarterKit, Markdown.configure({ indentation: { style: 'space', size: 2 } })],
    content,
    onUpdate: ({ editor }) => {
      onChange(editor.getMarkdown())
    },
    editorProps: {
      attributes: {
        class: 'prose prose-invert max-w-none focus:outline-none min-h-full px-8 py-6',
        style: `color: ${colors.text.primary}; font-family: Inter, system-ui, sans-serif;`
      }
    }
  })

  useEffect(() => {
    if (editor && content !== editor.getMarkdown()) {
      editor.commands.setContent(content)
    }
  }, [content, editor])

  return (
    <div className="h-full overflow-y-auto" style={{ backgroundColor: colors.bg.base }}>
      <EditorContent editor={editor} />
    </div>
  )
}
