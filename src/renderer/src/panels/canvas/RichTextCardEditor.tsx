import { useEffect, useMemo } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { Extension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { HighlightMark } from '../editor/extensions/highlight-mark'
import { colors } from '../../design/tokens'

interface RichTextCardEditorProps {
  readonly value: string
  readonly editing: boolean
  readonly onChange: (markdown: string) => void
  readonly onExit: (commit: boolean) => void
  readonly onSaveShortcut: () => void
}

function makeShortcutsExtension(
  onExit: (commit: boolean) => void,
  onSaveShortcut: () => void
): Extension {
  return Extension.create({
    name: 'textCardShortcuts',
    addKeyboardShortcuts() {
      const exitCommit = () => {
        onExit(true)
        return true
      }
      const save = () => {
        onSaveShortcut()
        return true
      }
      return {
        // Bind both Mod- and Meta- so tests (happy-dom reports non-Mac, where
        // ProseMirror maps Mod→Ctrl) and real macOS runtime both work.
        'Mod-Enter': exitCommit,
        'Meta-Enter': exitCommit,
        Escape: () => {
          onExit(false)
          return true
        },
        // Bind both uppercase and lowercase forms: when Shift is held,
        // event.key is typically 'S' on real browsers and on happy-dom; the
        // lowercase form matches the ProseMirror docstring convention.
        'Mod-Shift-s': save,
        'Meta-Shift-s': save,
        'Mod-Shift-S': save,
        'Meta-Shift-S': save
      }
    }
  })
}

export function RichTextCardEditor({
  value,
  editing,
  onChange,
  onExit,
  onSaveShortcut
}: RichTextCardEditorProps) {
  const extensions = useMemo(
    () => [
      StarterKit.configure({ codeBlock: false }),
      Markdown,
      TaskList,
      TaskItem.configure({ nested: true }),
      HighlightMark,
      makeShortcutsExtension(onExit, onSaveShortcut)
    ],
    [onExit, onSaveShortcut]
  )

  const editor = useEditor({
    extensions,
    content: value,
    editable: editing,
    onUpdate: ({ editor: ed }) => {
      const manager = ed.storage.markdown?.manager
      if (!manager) {
        onChange(ed.getText())
        return
      }
      const md = manager.serialize(ed.getJSON())
      if (typeof md === 'string') onChange(md)
    }
  })

  useEffect(() => {
    if (editor) editor.setEditable(editing)
  }, [editor, editing])

  return (
    <div
      className="te-text-card-editor w-full h-full p-3 text-sm overflow-auto"
      style={{ color: colors.text.primary }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {editor && <EditorContent editor={editor} />}
    </div>
  )
}
