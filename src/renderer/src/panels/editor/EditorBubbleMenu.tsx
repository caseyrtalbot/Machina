import { BubbleMenu } from '@tiptap/react/menus'
import type { Editor } from '@tiptap/react'

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
  // Console: hairline-square buttons. Active (aria-pressed) uses accent-muted bg
  // and accent-default fg; hover tint applies only to the inactive state.
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className="te-bubblemenu-btn"
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
      {/* Console-direction: hairline border on a knife-edge glass chrome surface. */}
      <div className="te-bubblemenu">
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
          <span className="te-bubblemenu-code">&lt;/&gt;</span>
        </FormatButton>

        <FormatButton
          active={editor.isActive('highlight')}
          onClick={() => editor.chain().focus().toggleMark('highlight').run()}
          title="Highlight (Cmd+Shift+H)"
        >
          <span className="te-bubblemenu-hl">H</span>
        </FormatButton>

        {/* Hairline divider — matches the chrome border weight */}
        <div aria-hidden="true" className="te-bubblemenu-divider" />

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
