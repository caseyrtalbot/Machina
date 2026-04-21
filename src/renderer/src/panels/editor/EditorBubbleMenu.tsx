import { BubbleMenu } from '@tiptap/react/menus'
import type { Editor } from '@tiptap/react'
import { colors, floatingPanel } from '../../design/tokens'

interface EditorBubbleMenuProps {
  readonly editor: Editor
}

interface FormatButtonProps {
  readonly active: boolean
  readonly onClick: () => void
  readonly title: string
  readonly children: React.ReactNode
}

function FormatButton({ active, onClick, title, children }: FormatButtonProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      style={{
        width: 30,
        height: 30,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 4,
        border: 'none',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: active ? 700 : 400,
        backgroundColor: active ? 'var(--color-accent-muted)' : 'transparent',
        color: active ? 'var(--color-accent-default)' : colors.text.secondary,
        transition: 'background-color 100ms ease'
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)'
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.backgroundColor = 'transparent'
      }}
    >
      {children}
    </button>
  )
}

export function EditorBubbleMenu({ editor }: EditorBubbleMenuProps) {
  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor: ed, state }) => {
        // Don't show in code blocks
        if (ed.isActive('codeBlock')) return false
        // Only show when there's a text selection
        const { from, to } = state.selection
        return from !== to
      }}
    >
      <div
        className="flex items-center gap-0.5 p-1"
        style={{
          backgroundColor: floatingPanel.glass.bg,
          backdropFilter: floatingPanel.glass.blur,
          borderRadius: 8,
          boxShadow: floatingPanel.shadowCompact
        }}
      >
        <FormatButton
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="Bold (Cmd+B)"
        >
          <strong>B</strong>
        </FormatButton>

        <FormatButton
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="Italic (Cmd+I)"
        >
          <em>I</em>
        </FormatButton>

        <FormatButton
          active={editor.isActive('strike')}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          title="Strikethrough (Cmd+Shift+S)"
        >
          <s>S</s>
        </FormatButton>

        <FormatButton
          active={editor.isActive('code')}
          onClick={() => editor.chain().focus().toggleCode().run()}
          title="Inline code (Cmd+E)"
        >
          <span style={{ fontFamily: 'monospace', fontSize: 12 }}>&lt;/&gt;</span>
        </FormatButton>

        <FormatButton
          active={editor.isActive('highlight')}
          onClick={() => editor.chain().focus().toggleMark('highlight').run()}
          title="Highlight (Cmd+Shift+H)"
        >
          <span
            style={{
              backgroundColor: 'rgba(234, 179, 8, 0.3)',
              padding: '0 3px',
              borderRadius: 2,
              fontSize: 12,
              lineHeight: 1
            }}
          >
            H
          </span>
        </FormatButton>

        <div
          style={{
            width: 1,
            height: 16,
            backgroundColor: 'rgba(255,255,255,0.1)',
            margin: '0 2px'
          }}
        />

        <FormatButton
          active={editor.isActive('link')}
          onClick={() => {
            if (editor.isActive('link')) {
              editor.chain().focus().unsetLink().run()
            } else {
              const url = window.prompt('URL')
              if (url) {
                editor.chain().focus().setLink({ href: url }).run()
              }
            }
          }}
          title="Link (Cmd+K)"
        >
          <svg
            width={14}
            height={14}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        </FormatButton>

        <FormatButton
          active={editor.isActive('conceptNode')}
          onClick={() => editor.chain().focus().toggleConceptNode().run()}
          title="Concept node"
        >
          <svg
            width={14}
            height={14}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          </svg>
        </FormatButton>
      </div>
    </BubbleMenu>
  )
}
