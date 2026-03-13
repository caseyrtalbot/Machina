import type { Editor } from '@tiptap/react'
import { colors, transitions } from '../../design/tokens'

interface ToolbarButtonProps {
  onClick: () => void
  active?: boolean
  disabled?: boolean
  title: string
  children: React.ReactNode
}

function ToolbarButton({ onClick, active = false, disabled = false, title, children }: ToolbarButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex items-center justify-center w-7 h-7 rounded text-xs font-medium transition-colors"
      style={{
        backgroundColor: active ? colors.accent.muted : 'transparent',
        color: active ? colors.accent.default : disabled ? colors.text.muted : colors.text.secondary,
        transition: transitions.default,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        borderRadius: 4,
      }}
    >
      {children}
    </button>
  )
}

function ToolbarSeparator() {
  return (
    <div
      className="w-px h-4 mx-1"
      style={{ backgroundColor: colors.border.default }}
    />
  )
}

interface EditorToolbarProps {
  editor: Editor | null
  mode: 'rich' | 'source'
  onToggleMode: () => void
}

export function EditorToolbar({ editor, mode, onToggleMode }: EditorToolbarProps) {
  const modeToggle = (
    <button
      onClick={onToggleMode}
      className="ml-auto text-xs px-2 py-1 rounded transition-colors"
      style={{
        backgroundColor: colors.accent.muted,
        color: colors.accent.default,
        transition: transitions.default,
        borderRadius: 4,
      }}
    >
      {mode === 'rich' ? 'Rich' : 'Source'}
    </button>
  )

  if (mode === 'source') {
    return (
      <div
        className="flex items-center px-3"
        style={{
          height: 36,
          backgroundColor: colors.bg.surface,
          borderBottom: `1px solid ${colors.border.default}`,
        }}
      >
        {modeToggle}
      </div>
    )
  }

  return (
    <div
      className="flex items-center gap-0.5 px-3"
      style={{
        height: 36,
        backgroundColor: colors.bg.surface,
        borderBottom: `1px solid ${colors.border.default}`,
      }}
    >
      {/* History */}
      <ToolbarButton
        onClick={() => editor?.chain().focus().undo().run()}
        disabled={!editor?.can().undo()}
        title="Undo"
      >
        ↩
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor?.chain().focus().redo().run()}
        disabled={!editor?.can().redo()}
        title="Redo"
      >
        ↪
      </ToolbarButton>

      <ToolbarSeparator />

      {/* Headings */}
      <ToolbarButton
        onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
        active={editor?.isActive('heading', { level: 1 }) ?? false}
        title="Heading 1"
      >
        H1
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
        active={editor?.isActive('heading', { level: 2 }) ?? false}
        title="Heading 2"
      >
        H2
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
        active={editor?.isActive('heading', { level: 3 }) ?? false}
        title="Heading 3"
      >
        H3
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor?.chain().focus().toggleHeading({ level: 4 }).run()}
        active={editor?.isActive('heading', { level: 4 }) ?? false}
        title="Heading 4"
      >
        H4
      </ToolbarButton>

      <ToolbarSeparator />

      {/* Inline */}
      <ToolbarButton
        onClick={() => editor?.chain().focus().toggleBold().run()}
        active={editor?.isActive('bold') ?? false}
        title="Bold"
      >
        <strong>B</strong>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor?.chain().focus().toggleItalic().run()}
        active={editor?.isActive('italic') ?? false}
        title="Italic"
      >
        <em>I</em>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor?.chain().focus().toggleStrike().run()}
        active={editor?.isActive('strike') ?? false}
        title="Strikethrough"
      >
        <s>S</s>
      </ToolbarButton>

      <ToolbarSeparator />

      {/* Lists */}
      <ToolbarButton
        onClick={() => editor?.chain().focus().toggleBulletList().run()}
        active={editor?.isActive('bulletList') ?? false}
        title="Bullet list"
      >
        •
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        active={editor?.isActive('orderedList') ?? false}
        title="Ordered list"
      >
        1.
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor?.chain().focus().toggleTaskList().run()}
        active={editor?.isActive('taskList') ?? false}
        title="Task list"
      >
        ☑
      </ToolbarButton>

      <ToolbarSeparator />

      {/* Code */}
      <ToolbarButton
        onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
        active={editor?.isActive('codeBlock') ?? false}
        title="Code block"
      >
        {'<>'}
      </ToolbarButton>

      {modeToggle}
    </div>
  )
}
